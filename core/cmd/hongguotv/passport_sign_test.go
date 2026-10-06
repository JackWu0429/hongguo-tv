package main

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func TestPassportSignatureVectors(t *testing.T) {
	data, err := os.ReadFile("testdata/passport-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Query, Body, SM3, F13, Proto, Helios, Gorgon, Medusa string
		TS, IV                                               uint32
		AESV3                                                []string `json:"aes_v3"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	iv, q, m := passportBranch(v.Query, []byte(v.Body), v.TS)
	if iv != v.IV {
		t.Fatalf("iv %x != %x", iv, v.IV)
	}
	if hex.EncodeToString(q[:]) != v.SM3 {
		t.Fatal("SM3 mismatch")
	}
	f13 := passportF13(iv, v.TS, q, m)
	if hex.EncodeToString(f13) != v.F13 {
		t.Fatal("F13 mismatch")
	}
	p := passportProto(v.Query, v.TS, 0x12345678, "7000000000000000001", q, m, f13)
	if hex.EncodeToString(p) != v.Proto {
		t.Fatalf("protobuf mismatch\ngot %x\nwant %s", p, v.Proto)
	}
	if passportHelios(v.TS, 0x12345678) != v.Helios {
		t.Fatal("Helios mismatch")
	}
	if passportGorgon(v.Query, []byte(v.Body), v.TS, 0x4567) != v.Gorgon {
		t.Fatal("Gorgon mismatch")
	}
	for i, want := range v.AESV3 {
		b := make([]byte, 256)
		for j := range b {
			b[j] = byte(j)
		}
		got, err := passportAESV3(b, v.TS+uint32(i))
		if err != nil || hex.EncodeToString(got) != want {
			t.Fatalf("AESV3 branch %d mismatch: got %x want %s", i, got[:33], want[:66])
		}
	}
	medusa, err := passportMedusa(v.Query, v.TS, 0x12345678, 0x87654321, 0x33445566, "7000000000000000001", iv, q, m)
	if err != nil || medusa != v.Medusa {
		t.Fatalf("Medusa mismatch: %v", err)
	}
}

func TestSM3StandardVector(t *testing.T) {
	digest := passportSM3([]byte("abc"))
	if hex.EncodeToString(digest[:]) != "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0" {
		t.Fatal("SM3 standard vector failed")
	}
}
