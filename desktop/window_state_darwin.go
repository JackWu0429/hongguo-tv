//go:build darwin

package main

/*
#cgo LDFLAGS: -framework Cocoa
int hongguoWindowHidden(void);
*/
import "C"

import "context"

func desktopWindowHidden(context.Context) bool { return C.hongguoWindowHidden() != 0 }
