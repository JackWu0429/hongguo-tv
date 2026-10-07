package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestIndependentCoreInstancesIgnoreOtherListeners(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"ok":true,"service":"hongguo-tv-core","version":"old","instance_id":"stale"}`)
	}))
	defer stale.Close()
	var addresses []string
	for _, instance := range []string{"first-child", "second-child"} {
		var ready bytes.Buffer
		listener, err := coreListener(0, instance, &ready)
		if err != nil {
			t.Fatal(err)
		}
		s := &server{instanceID: instance, startedAt: time.Now()}
		httpServer := &http.Server{Handler: http.HandlerFunc(s.status)}
		done := make(chan error, 1)
		go func() { done <- httpServer.Serve(listener) }()
		t.Cleanup(func() { httpServer.Close(); <-done })
		var port int
		var reported string
		if _, err := fmt.Sscanf(ready.String(), "HONGGUO_TV_READY %d %s", &port, &reported); err != nil || reported != instance {
			t.Fatalf("invalid ready line: %q", ready.String())
		}
		url := fmt.Sprintf("http://127.0.0.1:%d", port)
		if url == stale.URL || (len(addresses) > 0 && url == addresses[0]) {
			t.Fatal("core reused another listener")
		}
		addresses = append(addresses, url)
		res, err := http.Get(url + "/api/v1/status")
		if err != nil {
			t.Fatal(err)
		}
		var status statusResponse
		err = json.NewDecoder(res.Body).Decode(&status)
		res.Body.Close()
		if err != nil || !status.OK || status.Service != "hongguo-tv-core" || status.InstanceID != instance || status.Version != version || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("wrong instance status: %+v, %v", status, err)
		}
	}
}

type failingReadyWriter struct{}

func (failingReadyWriter) Write([]byte) (int, error) { return 0, errors.New("closed stdout") }

func TestCoreListenerRejectsInvalidHandshake(t *testing.T) {
	for _, test := range []struct {
		port     int
		instance string
		writer   io.Writer
	}{
		{-1, "child", io.Discard}, {65536, "child", io.Discard}, {0, "child\nother", io.Discard}, {0, "child", failingReadyWriter{}},
	} {
		listener, err := coreListener(test.port, test.instance, test.writer)
		if listener != nil || err == nil {
			t.Fatalf("invalid configuration accepted: %+v", test)
		}
	}
	var output strings.Builder
	listener, err := coreListener(0, "", &output)
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
	if output.Len() != 0 {
		t.Fatal("desktop runtime emitted Android handshake")
	}
}

func TestParentWatchStopsOrphan(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var parent atomic.Int64
	parent.Store(123)
	done := make(chan struct{})
	go func() {
		watchParent(ctx, 123, time.Millisecond, func() int { return int(parent.Load()) }, cancel)
		close(done)
	}()
	if ctx.Err() != nil {
		t.Fatal("live parent canceled")
	}
	parent.Store(1)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("orphan stayed alive")
	}
	<-done
}

func TestDesktopParentWatchDoesNotCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	watchParent(ctx, 0, time.Millisecond, func() int { return 1 }, cancel)
	if ctx.Err() != nil {
		t.Fatal("desktop runtime canceled")
	}
}
