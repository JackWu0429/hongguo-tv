package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestMiniReelRangeByteRangeParser(t *testing.T) {
	for _, test := range []struct {
		value          string
		start, end     int64
		partial, valid bool
	}{
		{"", 0, 99, false, true},
		{"bytes=5-9", 5, 9, true, true},
		{"bytes=90-", 90, 99, true, true},
		{"bytes=-10", 90, 99, true, true},
		{"bytes=0-999", 0, 99, true, true},
		{"bytes=100-", 0, 0, false, false},
		{"bytes=1-2,4-5", 0, 0, false, false},
	} {
		start, end, partial, err := parseMiniReelByteRange(test.value, 100)
		if (err == nil) != test.valid || test.valid && (start != test.start || end != test.end || partial != test.partial) {
			t.Errorf("parse range %q = %d-%d partial=%v err=%v", test.value, start, end, partial, err)
		}
	}
}

func TestDecryptMiniReelCTRFragmentAtArbitraryOffsets(t *testing.T) {
	key := bytes.Repeat([]byte{0x37}, 16)
	iv := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	plain := make([]byte, 80)
	for i := range plain {
		plain[i] = byte(i*3 + 7)
	}
	block, _ := aes.NewCipher(key)
	ciphertext := append([]byte(nil), plain...)
	cipher.NewCTR(block, append(append([]byte(nil), iv...), make([]byte, 8)...)).XORKeyStream(ciphertext, ciphertext)
	for _, offset := range []int64{0, 1, 15, 16, 17, 31, 63} {
		fragment := append([]byte(nil), ciphertext[offset:offset+9]...)
		if err := decryptMiniReelCTRFragment(fragment, iv, block, offset); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(fragment, plain[offset:offset+9]) {
			t.Fatalf("fragment at offset %d did not decrypt", offset)
		}
	}
}

func TestMiniReelRangeMediaReturnsPatchedAndDecryptedFragments(t *testing.T) {
	key := bytes.Repeat([]byte{0x29}, 16)
	iv := []byte{8, 7, 6, 5, 4, 3, 2, 1}
	plain := []byte("range streaming decrypts only the requested CENC sample bytes")
	block, _ := aes.NewCipher(key)
	ciphertext := append([]byte(nil), plain...)
	cipher.NewCTR(block, append(append([]byte(nil), iv...), make([]byte, 8)...)).XORKeyStream(ciphertext, ciphertext)
	file := makeRangeMP4Fixture(t, ciphertext, iv)
	const etag = `"stable-media-etag"`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-Range") != "" && r.Header.Get("If-Range") != etag {
			t.Errorf("unexpected If-Range %q", r.Header.Get("If-Range"))
		}
		start, end, partial, err := parseMiniReelByteRange(r.Header.Get("Range"), int64(len(file)))
		if err != nil || !partial {
			t.Errorf("invalid upstream Range %q: %v", r.Header.Get("Range"), err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(file)))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(file[start : end+1])
	}))
	defer upstream.Close()

	option := miniReelOption{URL: upstream.URL, Key: key, Quality: "720P"}
	source, err := openMiniReelRangeSource(context.Background(), option, "123456789")
	if err != nil {
		t.Fatalf("open range source: %v", err)
	}
	if len(source.Samples) != 1 || !bytes.Contains(source.Prefix, []byte("hvc1")) {
		t.Fatalf("index/header not prepared: samples=%d prefix=%q", len(source.Samples), source.Prefix)
	}

	sample := source.Samples[0]
	start, end := int64(sample.Offset+11), int64(sample.Offset+26)
	request := httptest.NewRequest(http.MethodGet, "/minireel-proxy/media/test.mp4", nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	response := httptest.NewRecorder()
	serveMiniReelRangeMedia(response, request, source)
	if response.Code != http.StatusPartialContent || response.Header().Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, end, len(file)) {
		t.Fatalf("unexpected local range response: %d %#v", response.Code, response.Header())
	}
	if got, want := response.Body.Bytes(), plain[11:27]; !bytes.Equal(got, want) {
		t.Fatalf("decrypted range = %q, want %q", got, want)
	}

	request = httptest.NewRequest(http.MethodGet, "/minireel-proxy/media/test.mp4", nil)
	request.Header.Set("Range", fmt.Sprintf("bytes=0-%d", len(source.Prefix)-1))
	response = httptest.NewRecorder()
	serveMiniReelRangeMedia(response, request, source)
	if response.Code != http.StatusPartialContent || !bytes.Contains(response.Body.Bytes(), []byte("hvc1")) || bytes.Contains(response.Body.Bytes(), []byte("sinf")) || !bytes.Contains(response.Body.Bytes(), []byte("free")) {
		t.Fatalf("patched MP4 initialization was not served: %d", response.Code)
	}
}

func makeRangeMP4Fixture(t *testing.T, encrypted, iv []byte) []byte {
	t.Helper()
	stscPayload := append([]byte{0, 0, 0, 0}, make([]byte, 16)...)
	binary.BigEndian.PutUint32(stscPayload[4:8], 1)
	binary.BigEndian.PutUint32(stscPayload[8:12], 1)
	binary.BigEndian.PutUint32(stscPayload[12:16], 1)
	stszPayload := append([]byte{0, 0, 0, 0}, make([]byte, 12)...)
	binary.BigEndian.PutUint32(stszPayload[4:8], 0)
	binary.BigEndian.PutUint32(stszPayload[8:12], 1)
	binary.BigEndian.PutUint32(stszPayload[12:16], uint32(len(encrypted)))
	stcoPayload := append([]byte{0, 0, 0, 0}, make([]byte, 8)...)
	binary.BigEndian.PutUint32(stcoPayload[4:8], 1)
	sencPayload := append([]byte{0, 0, 0, 0}, make([]byte, 4+len(iv))...)
	binary.BigEndian.PutUint32(sencPayload[4:8], 1)
	copy(sencPayload[8:], iv)
	entryPayload := make([]byte, visualSampleEntryHeaderSize)
	entryPayload = append(entryPayload, makeMP4Box("sinf", makeMP4Box("frma", []byte("hvc1")))...)
	stsdPayload := append([]byte{0, 0, 0, 0, 0, 0, 0, 1}, makeMP4Box("encv", entryPayload)...)
	stbl := makeMP4Box("stbl", bytes.Join([][]byte{
		makeMP4Box("stsd", stsdPayload), makeMP4Box("stsc", stscPayload),
		makeMP4Box("stsz", stszPayload), makeMP4Box("stco", stcoPayload), makeMP4Box("senc", sencPayload),
	}, nil))
	moov := makeMP4Box("moov", makeMP4Box("trak", makeMP4Box("mdia", makeMP4Box("minf", stbl))))
	ftyp := makeMP4Box("ftyp", []byte("isom\x00\x00\x02\x00isomiso2"))
	mdat := makeMP4Box("mdat", encrypted)
	root, err := parseMP4Boxes(moov, 0, len(moov))
	if err != nil || len(root) != 1 {
		t.Fatalf("parse fixture moov: %v", err)
	}
	stblBox, ok := findMP4Path(moov, root[0], "trak", "mdia", "minf", "stbl")
	if !ok {
		t.Fatal("fixture stbl missing")
	}
	stco, ok := findMP4Child(moov, stblBox, "stco")
	if !ok {
		t.Fatal("fixture stco missing")
	}
	binary.BigEndian.PutUint32(moov[stco.Payload+8:stco.Payload+12], uint32(len(ftyp)+len(moov)+8))
	return append(append(append([]byte(nil), ftyp...), moov...), mdat...)
}

func TestMiniReelFindMoovRequiresFrontLoadedIndex(t *testing.T) {
	moov := makeMP4Box("moov", nil)
	mdat := makeMP4Box("mdat", make([]byte, 20))
	file := append(mdat, moov...)
	if _, _, err := miniReelFindMoovEnd(file, int64(len(file))); err == nil || !strings.Contains(err.Error(), "follows media data") {
		t.Fatalf("tail moov accepted: %v", err)
	}
}

func TestMiniReelRangeRejectsIgnoredRangeAndWeakETag(t *testing.T) {
	for _, test := range []struct {
		name         string
		status       int
		etag         string
		contentRange string
	}{
		{"ignored Range", http.StatusOK, `"stable"`, ""},
		{"weak ETag", http.StatusPartialContent, `W/"weak"`, "bytes 0-7/100"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("ETag", test.etag)
				if test.contentRange != "" {
					w.Header().Set("Content-Range", test.contentRange)
				}
				w.WriteHeader(test.status)
				_, _ = w.Write(make([]byte, 8))
			}))
			defer server.Close()
			if _, err := openMiniReelRangeSource(context.Background(), miniReelOption{URL: server.URL, Quality: "720P"}, "123"); err == nil {
				t.Fatal("unsupported range source was accepted")
			}
		})
	}
}

func TestMiniReelRangeRejectsChangedValidator(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"different"`)
		w.Header().Set("Content-Range", "bytes 0-3/8")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()
	source := &miniReelRangeSource{URL: server.URL, ETag: `"stable"`, Length: 8}
	if _, err := source.fetch(context.Background(), 0, 3); err == nil || !strings.Contains(err.Error(), "ETag changed") {
		t.Fatalf("changed source validator accepted: %v", err)
	}
}

func TestMiniReelRangeRetriesTransientUpstreamFailure(t *testing.T) {
	media := []byte("transient range media")
	const etag = `"retry-etag"`
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		start, end, partial, err := parseMiniReelByteRange(r.Header.Get("Range"), int64(len(media)))
		if err != nil || !partial || start != 0 || end != int64(len(media))-1 {
			t.Fatalf("unexpected retry range %q: %v", r.Header.Get("Range"), err)
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(media)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(media)
	}))
	defer server.Close()
	source := &miniReelRangeSource{URL: server.URL, ETag: etag, Length: int64(len(media))}
	got, err := source.fetch(context.Background(), 0, int64(len(media))-1)
	if err != nil || !bytes.Equal(got, media) {
		t.Fatalf("transient range did not recover: bytes=%q err=%v attempts=%d", got, err, attempts)
	}
	if attempts != 2 {
		t.Fatalf("expected one retry, got %d attempts", attempts)
	}
}

func TestMiniReelRangeResumesAfterPartialUpstreamResponse(t *testing.T) {
	media := []byte("partial range response should resume from the received offset")
	const etag = `"resume-etag"`
	var requests []string
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start, end, partial, err := parseMiniReelByteRange(r.Header.Get("Range"), int64(len(media)))
		if err != nil || !partial {
			t.Fatalf("invalid resume range %q: %v", r.Header.Get("Range"), err)
		}
		requests = append(requests, r.Header.Get("Range"))
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(media)))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		if calls == 0 {
			calls++
			_, _ = w.Write(media[start : start+7])
			return
		}
		_, _ = w.Write(media[start : end+1])
	}))
	defer server.Close()

	oldDelays := miniReelRangeRetryDelays
	miniReelRangeRetryDelays = [...]time.Duration{0, 0}
	defer func() { miniReelRangeRetryDelays = oldDelays }()

	source := &miniReelRangeSource{URL: server.URL, ETag: etag, Length: int64(len(media))}
	got, err := source.fetch(context.Background(), 0, int64(len(media))-1)
	if err != nil || !bytes.Equal(got, media) {
		t.Fatalf("partial upstream response did not resume: bytes=%q err=%v requests=%v", got, err, requests)
	}
	if len(requests) != 2 || requests[0] != "bytes=0-"+strconv.Itoa(len(media)-1) || requests[1] != "bytes=7-"+strconv.Itoa(len(media)-1) {
		t.Fatalf("unexpected resume requests: %v", requests)
	}
}

func TestMiniReelRangeWithoutHeaderStreamsInBoundedChunks(t *testing.T) {
	media := bytes.Repeat([]byte("range-data-"), 70_000)
	const etag = `"stream-etag"`
	requests, largest := 0, int64(0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start, end, partial, err := parseMiniReelByteRange(r.Header.Get("Range"), int64(len(media)))
		if err != nil || !partial {
			t.Errorf("invalid streamed upstream range %q: %v", r.Header.Get("Range"), err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requested := end - start + 1
		requests++
		if requested > largest {
			largest = requested
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(media)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(media[start : end+1])
	}))
	defer server.Close()
	source := &miniReelRangeSource{URL: server.URL, ETag: etag, Length: int64(len(media))}
	response := httptest.NewRecorder()
	serveMiniReelRangeMedia(response, httptest.NewRequest(http.MethodGet, "/media", nil), source)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), media) {
		t.Fatalf("full stream mismatch: status=%d bytes=%d", response.Code, response.Body.Len())
	}
	if requests < 2 || largest > miniReelRangeChunkBytes {
		t.Fatalf("stream was not bounded: requests=%d largest=%d", requests, largest)
	}
}

func TestMiniReelMediaRangeCORSPreflight(t *testing.T) {
	response := httptest.NewRecorder()
	handleMiniReelMedia(response, httptest.NewRequest(http.MethodOptions, "/minireel-proxy/media/aaaaaaaaaaaaaaaaaaaaaaaa.mp4", nil))
	if response.Code != http.StatusNoContent || !strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "If-Range") {
		t.Fatalf("range preflight not supported: %d %#v", response.Code, response.Header())
	}
}
