package main

import (
	"encoding/base64"
	"regexp"
	"strings"
	"unicode"

	qrcode "github.com/skip2/go-qrcode"
)

var smsRecipientRE = regexp.MustCompile(`^\+?[0-9]{5,20}$`)

// Only the server-supplied recipient and message go into the local QR.
// No login phone, verification code, session credentials or external URL.
func smsQRPayload(number, content string) string {
	if !smsRecipientRE.MatchString(number) || content == "" || len(content) > 256 || strings.IndexFunc(content, unicode.IsControl) >= 0 {
		return ""
	}
	return "SMSTO:" + number + ":" + content
}

func smsQRDataURL(number, content string) string {
	payload := smsQRPayload(number, content)
	if payload == "" {
		return ""
	}
	png, err := qrcode.Encode(payload, qrcode.Medium, 240)
	if err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}
