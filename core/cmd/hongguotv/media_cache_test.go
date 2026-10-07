package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMediaCacheRootsKeepActiveCoreAndRemoveExitedCore(t *testing.T) {
	base := t.TempDir()
	root := func(name string) string {
		p := filepath.Join(base, name)
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
		return p
	}
	current, active, exited := root("minireel-go-current"), root("minireel-go-active"), root("minireel-go-exited")
	activeLease, err := createMediaCacheLease(active)
	if err == os.ErrInvalid {
		t.Skip("native cache leases unavailable")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer activeLease.Close()
	exitedLease, err := createMediaCacheLease(exited)
	if err != nil {
		t.Fatal(err)
	}
	exitedLease.Close()
	other := root("account-records")
	cleanupMediaCacheRoots(base, current, true)
	for _, p := range []string{current, active, other} {
		if _, err := os.Stat(p); err != nil {
			t.Fatal("removed live or unrelated directory", p, err)
		}
	}
	if _, err := os.Stat(exited); !os.IsNotExist(err) {
		t.Fatal("exited cache retained", err)
	}
	activeLease.Close()
	cleanupMediaCacheRoots(base, current, true)
	if _, err := os.Stat(active); !os.IsNotExist(err) {
		t.Fatal("former active cache did not become reclaimable", err)
	}
}

func TestLegacyMediaMigrationPreservesRecentAndUnknownFiles(t *testing.T) {
	base := t.TempDir()
	probe, err := os.CreateTemp(base, "lock-probe")
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Close()
	if lockMediaCacheLease(probe) == os.ErrInvalid {
		t.Skip("native cache leases unavailable")
	}
	token := "012345678901234567890123"
	makeRoot := func(name string, old bool, unknown bool) string {
		root := filepath.Join(base, "minireel-go-"+name)
		dir := filepath.Join(root, token)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, token+".mp4"), []byte("media"), 0600); err != nil {
			t.Fatal(err)
		}
		if unknown {
			if err := os.WriteFile(filepath.Join(root, "library.json"), []byte("records"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if old {
			filepath.WalkDir(root, func(path string, _ os.DirEntry, err error) error {
				if err != nil {
					t.Fatal(err)
				}
				stamp := time.Now().Add(-miniReelTTL - time.Minute)
				if err := os.Chtimes(path, stamp, stamp); err != nil {
					t.Fatal(err)
				}
				return nil
			})
		}
		return root
	}
	old, recent, unknown := makeRoot("old", true, false), makeRoot("recent", false, false), makeRoot("unknown", true, true)
	cleanupMediaCacheRoots(base, "", false)
	if _, err := os.Stat(old); err != nil {
		t.Fatal("legacy migration ran in shared directory", err)
	}
	cleanupMediaCacheRoots(base, "", true)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("expired legacy media retained", err)
	}
	for _, p := range []string{recent, unknown} {
		if _, err := os.Stat(p); err != nil {
			t.Fatal("recent media or unknown data removed", p, err)
		}
	}
}

func TestMediaCacheRootsDoNotFollowSymlinks(t *testing.T) {
	base, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(base, "minireel-go-symlink")); err != nil {
		t.Skip(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "keep"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	cleanupMediaCacheRoots(base, "", true)
	if _, err := os.Stat(filepath.Join(outside, "keep")); err != nil {
		t.Fatal("followed cache symlink", err)
	}
}

func TestMediaCacheStartupAndLaterLegacyCleanup(t *testing.T) {
	isolatedMediaJobs(t)
	base := t.TempDir()
	t.Setenv("MINIREEL_CACHE_DIR", base)
	token := "012345678901234567890123"
	legacy := filepath.Join(base, "minireel-go-legacy")
	dir := filepath.Join(legacy, token)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, token+".mp4"), []byte("media"), 0600); err != nil {
		t.Fatal(err)
	}
	miniReelState.Lock()
	miniReelState.root = ""
	miniReelState.Unlock()
	if err := ensureMiniReelRoot(); err != nil {
		t.Fatal(err)
	}
	miniReelState.Lock()
	root, lease := miniReelState.root, miniReelState.lease
	miniReelState.Unlock()
	if lease == nil {
		t.Skip("native cache leases unavailable")
	}
	if filepath.Dir(root) != base {
		t.Fatal("configured cache root ignored", root)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatal("recent legacy cache removed at startup", err)
	}
	stamp := time.Now().Add(-miniReelTTL - time.Minute)
	if err := filepath.WalkDir(legacy, func(path string, _ os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Chtimes(path, stamp, stamp)
	}); err != nil {
		t.Fatal(err)
	}
	miniReelState.Lock()
	miniReelState.lastRootCleanup = time.Now().Add(-2 * time.Minute)
	miniReelCleanupLocked()
	miniReelState.Unlock()
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("expired legacy cache was not revisited", err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal("current cache removed", err)
	}
}

func TestMediaCacheEvictsOldFilesAt512MiBAndProtectsWaiters(t *testing.T) {
	root := isolatedMediaJobs(t)
	for i := 0; i < 5; i++ {
		token := fmt.Sprintf("%024x", i)
		dir := filepath.Join(root, token)
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, token+".mp4")
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		// Sparse files exercise size accounting without downloading real media.
		if err := file.Truncate(128 << 20); err != nil {
			t.Fatal(err)
		}
		file.Close()
		ready := make(chan struct{})
		close(ready)
		job := &miniReelMediaJob{Ready: ready, Path: path, Accessed: time.Now().Add(time.Duration(i) * time.Second)}
		if i == 0 {
			job.Waiters = 1
		}
		miniReelState.Lock()
		miniReelState.jobs[token] = job
		miniReelState.Unlock()
	}
	miniReelState.Lock()
	miniReelCleanupLocked()
	miniReelState.Unlock()
	if _, err := os.Stat(filepath.Join(root, fmt.Sprintf("%024x", 0))); err != nil {
		t.Fatal("active consumer evicted", err)
	}
	if _, err := os.Stat(filepath.Join(root, fmt.Sprintf("%024x", 1))); !os.IsNotExist(err) {
		t.Fatal("oldest unused file retained", err)
	}
	if size := miniReelDirectorySize(root); size != miniReelMaxCache {
		t.Fatal("cache size exceeds threshold", size)
	}
	miniReelState.Lock()
	for _, job := range miniReelState.jobs {
		job.Waiters = 0
		job.Accessed = time.Now().Add(-miniReelTTL - time.Second)
	}
	miniReelCleanupLocked()
	count := len(miniReelState.jobs)
	miniReelState.Unlock()
	if count != 0 || miniReelDirectorySize(root) != 0 {
		t.Fatal("expired cache survived TTL", count)
	}
}
