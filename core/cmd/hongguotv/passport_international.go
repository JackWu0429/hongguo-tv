package main

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/rc4"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/bits"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type passportSignatureMode uint8

const (
	passportSignatureFull          passportSignatureMode = 0
	passportSignatureInternational passportSignatureMode = 4
)

// The v1.2.4 Login.call branch for non-+86 phones selects mode 4. Its Gorgon
// uses standard RC4 swaps, unlike the existing full-mode routine. Keep the
// latter intact for mainland accounts and media requests.
func passportInternationalGorgon(query string, body []byte, ts uint32, nonce uint16) string {
	queryHash := md5.Sum([]byte(query))
	var bodyHash [16]byte
	if len(body) > 0 {
		bodyHash = md5.Sum(body)
	}
	data := make([]byte, 20)
	copy(data, queryHash[:4])
	copy(data[4:], bodyHash[:4])
	binary.LittleEndian.PutUint32(data[12:], 67503104)
	binary.BigEndian.PutUint32(data[16:], ts)
	key := [8]byte{0x4a, 0x40, 0x16, byte(nonce >> 8), 0x47, 0x6c, 1, byte(nonce)}
	cipher, _ := rc4.NewCipher(key[:]) // Fixed eight-byte protocol key.
	cipher.XORKeyStream(data, data)
	for i := range data {
		data[i] = bits.RotateLeft8(data[i], 4)
		next := data[0]
		if i < len(data)-1 {
			next = data[i+1]
		}
		data[i] = ^(bits.Reverse8(data[i]^next) ^ 20)
	}
	header := []byte{0x84, 4, byte(nonce), byte(nonce >> 8), 0x40, 1}
	return hex.EncodeToString(append(header, data...))
}

func signInternationalPassportRequest(q url.Values, body []byte, stamp int64) (string, http.Header, error) {
	// The reference Session.send also tunes _rticket before calling Sign.
	raw, _, _, _, err := passportTuneQuery(q, body, stamp)
	if err != nil {
		return "", nil, err
	}
	var random [14]byte // Gorgon nonce, Helios nonce, trace randomness.
	if _, err := rand.Read(random[:]); err != nil {
		return "", nil, err
	}
	ts := uint32(stamp / 1000)
	var bigEndian [4]byte
	binary.BigEndian.PutUint32(bigEndian[:], ts)
	// Match the reference's millisecond-prefix trace format; it is not a
	// general implementation of the Argus/Ladon signing algorithms.
	trace := fmt.Sprintf("%08x10%x", uint32(stamp), random[6:])
	h := make(http.Header)
	h.Set("X-Khronos", strconv.FormatUint(uint64(ts), 10))
	h.Set("X-SS-Req-Ticket", q.Get("_rticket"))
	h.Set("X-Argus", base64.StdEncoding.EncodeToString(protocolLE(ts)))
	h.Set("X-Ladon", base64.StdEncoding.EncodeToString(bigEndian[:]))
	h.Set("X-Helios", passportHelios(ts, binary.LittleEndian.Uint32(random[2:6])))
	h.Set("X-Gorgon", passportInternationalGorgon(raw, body, ts, binary.LittleEndian.Uint16(random[:2])))
	h.Set("X-TT-Trace-Id", "00-"+trace+"-"+trace[:16]+"-01")
	if len(body) > 0 {
		stub := md5.Sum(body)
		h.Set("X-SS-STUB", strings.ToUpper(hex.EncodeToString(stub[:])))
	}
	return raw, h, nil
}
