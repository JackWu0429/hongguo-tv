package main

import (
	"encoding/binary"
	"testing"
)

func TestRenameEncryptedSampleEntryUsesKnownFrmaCodec(t *testing.T) {
	for _, want := range []string{"avc1", "hvc1", "hev1"} {
		t.Run(want, func(t *testing.T) {
			data, stbl := syntheticEncryptedVideoTrack(want, true)
			if err := renameEncryptedSampleEntry(data, stbl); err != nil {
				t.Fatal(err)
			}
			got := firstSampleEntryType(t, data, stbl)
			if got != want {
				t.Fatalf("sample entry type = %q, want %q", got, want)
			}
		})
	}
}

func TestRenameEncryptedSampleEntryFallsBackToHEVCWithoutUsableFrma(t *testing.T) {
	for _, name := range []string{"missing frma", "unknown frma", "truncated sinf"} {
		t.Run(name, func(t *testing.T) {
			data, stbl := syntheticEncryptedVideoTrack("av01", name != "missing frma")
			if name == "truncated sinf" {
				stsd, ok := findMP4Child(data, stbl, "stsd")
				if !ok {
					t.Fatal("synthetic stsd missing")
				}
				entry, ok := firstMP4BoxMust(t, data, stsd, "encv")
				if !ok {
					t.Fatal("synthetic sample entry missing")
				}
				sinf, ok := firstMP4BoxMust(t, data, entry, "sinf")
				if !ok {
					t.Fatal("synthetic sinf missing")
				}
				binary.BigEndian.PutUint32(data[sinf.Start:sinf.Start+4], uint32(sinf.Size+10))
			}
			if err := renameEncryptedSampleEntry(data, stbl); err != nil {
				t.Fatal(err)
			}
			if got := firstSampleEntryType(t, data, stbl); got != "hvc1" {
				t.Fatalf("sample entry type = %q, want legacy fallback hvc1", got)
			}
		})
	}
}

func TestRenameEncryptedSampleEntryKeepsAudioMapping(t *testing.T) {
	stsd := makeMP4Box("stsd", append([]byte{0, 0, 0, 0, 0, 0, 0, 1}, makeMP4Box("enca", nil)...))
	data := makeMP4Box("stbl", stsd)
	root, err := parseMP4Boxes(data, 0, len(data))
	if err != nil || len(root) != 1 {
		t.Fatalf("parse synthetic audio track: %v", err)
	}
	if err := renameEncryptedSampleEntry(data, root[0]); err != nil {
		t.Fatal(err)
	}
	if got := firstSampleEntryType(t, data, root[0]); got != "mp4a" {
		t.Fatalf("sample entry type = %q, want mp4a", got)
	}
}

func syntheticEncryptedVideoTrack(frma string, includeSinf bool) ([]byte, mp4Box) {
	entryPayload := make([]byte, visualSampleEntryHeaderSize)
	if includeSinf {
		entryPayload = append(entryPayload, makeMP4Box("sinf", makeMP4Box("frma", []byte(frma)))...)
	}
	entry := makeMP4Box("encv", entryPayload)
	stsdPayload := []byte{0, 0, 0, 0, 0, 0, 0, 1}
	stsdPayload = append(stsdPayload, entry...)
	data := makeMP4Box("stbl", makeMP4Box("stsd", stsdPayload))
	root, err := parseMP4Boxes(data, 0, len(data))
	if err != nil || len(root) != 1 {
		panic("invalid synthetic MP4 track")
	}
	return data, root[0]
}

func makeMP4Box(typ string, payload []byte) []byte {
	box := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(box[:4], uint32(len(box)))
	copy(box[4:8], typ)
	copy(box[8:], payload)
	return box
}

func firstSampleEntryType(t *testing.T, data []byte, stbl mp4Box) string {
	t.Helper()
	stsd, ok := findMP4Child(data, stbl, "stsd")
	if !ok || stsd.Payload+8 > stsd.End {
		t.Fatal("synthetic stsd missing")
	}
	entry, ok := firstMP4BoxMust(t, data, stsd, "")
	if !ok {
		t.Fatal("synthetic sample entry missing")
	}
	return entry.Type
}

func firstMP4BoxMust(t *testing.T, data []byte, parent mp4Box, typ string) (mp4Box, bool) {
	t.Helper()
	start := parent.Payload
	if parent.Type == "stsd" {
		start += 8
	} else if parent.Type == "encv" {
		start += visualSampleEntryHeaderSize
	}
	children, err := parseMP4Boxes(data, start, parent.End)
	if err != nil {
		t.Fatal(err)
	}
	for _, child := range children {
		if typ == "" || child.Type == typ {
			return child, true
		}
	}
	return mp4Box{}, false
}
