//go:build !linux

package main

func configureDesktopMedia()         {}
func runDesktopDiagnosticMode() bool { return false }
