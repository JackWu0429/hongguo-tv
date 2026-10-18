//go:build !darwin

package main

import (
	"context"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func desktopWindowHidden(ctx context.Context) bool { return wruntime.WindowIsMinimised(ctx) }
