//go:build !unix

package main

import "os"

// Other platforms keep their existing in-process cache policy. Until a native
// lease is available there, do not delete another process's cache directories.
func lockMediaCacheLease(file *os.File) error { return os.ErrInvalid }
