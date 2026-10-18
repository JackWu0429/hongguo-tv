//go:build !windows

package main

import (
	"os"
	"path/filepath"
)

func downloadDirectory() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, "Downloads"), err
}
