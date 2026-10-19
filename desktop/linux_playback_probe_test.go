//go:build linux && linux_playback_probe

package main

import "testing"

func TestLinuxPlaybackProbe(t *testing.T) {
	// go test links the application package under its import path, not main.
	version = "linux-playback-validation"
	desktopVersion = "0.2.92-linux-validation"
	if err := runLinuxPlaybackProbe(); err != nil {
		t.Fatal(err)
	}
}
