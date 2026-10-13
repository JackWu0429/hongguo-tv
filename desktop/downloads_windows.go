//go:build windows

package main

import "golang.org/x/sys/windows"

func downloadDirectory() (string, error) {
	return windows.KnownFolderPath(windows.FOLDERID_Downloads, windows.KF_FLAG_DEFAULT)
}
