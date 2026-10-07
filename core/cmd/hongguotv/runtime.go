package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Android obtains the address only from its own child's stdout, then checks
// instance_id and the compiled version over HTTP before opening the WebView.
func coreListener(port int, instanceID string, ready io.Writer) (net.Listener, error) {
	if port < 0 || port > 65535 || strings.ContainsAny(instanceID, " \t\r\n") {
		return nil, errors.New("invalid local runtime configuration")
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return nil, err
	}
	if instanceID != "" {
		_, err = fmt.Fprintf(ready, "HONGGUO_TV_READY %d %s\n", listener.Addr().(*net.TCPAddr).Port, instanceID)
		if err != nil {
			listener.Close()
			return nil, err
		}
	}
	return listener, nil
}

func watchParent(ctx context.Context, expectedPID int, interval time.Duration, parentPID func() int, cancel context.CancelFunc) {
	if expectedPID <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if parentPID() != expectedPID {
			cancel()
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func serveLocalCore(ctx context.Context, port int, instanceID string, parentPID int, handler http.Handler) error {
	// Do not publish a child that has already outlived its Android host.
	if parentPID > 0 && os.Getppid() != parentPID {
		return errors.New("Android host process has stopped")
	}
	listener, err := coreListener(port, instanceID, os.Stdout)
	if err != nil {
		return err
	}
	defer listener.Close()
	log.Printf("hongguo-tv core %s listening on %s", version, listener.Addr())
	runtimeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go watchParent(runtimeCtx, parentPID, time.Second, os.Getppid, cancel)
	httpServer := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-runtimeCtx.Done()
		// Closing also cancels media requests before the child exits.
		httpServer.Close()
	}()
	err = httpServer.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
