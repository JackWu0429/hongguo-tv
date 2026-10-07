//go:build unix

package main

import (
	"os"
	"syscall"
)

// Holding this descriptor protects a running core's entire cache directory.
// The kernel releases the lock even if Android force-stops the application.
func lockMediaCacheLease(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}
