package main

import (
	"errors"
	"regexp"
	"sort"
	"strings"
)

// Keep this list aligned with the regions exposed by the official login UI.
// The upstream Passport endpoint still decides whether a particular number
// can receive SMS; this list only controls the app's input and normalization.
type accountPhoneCountry struct {
	Code string
	Name string
	Min  int
	Max  int
}

var accountPhoneCountries = []accountPhoneCountry{
	{Code: "+86", Name: "中国大陆", Min: 11, Max: 11},
	{Code: "+852", Name: "中国香港", Min: 8, Max: 8},
	{Code: "+853", Name: "中国澳门", Min: 8, Max: 8},
	{Code: "+886", Name: "中国台湾", Min: 9, Max: 10},
	{Code: "+60", Name: "马来西亚", Min: 9, Max: 10},
	{Code: "+65", Name: "新加坡", Min: 8, Max: 8},
	{Code: "+62", Name: "印度尼西亚", Min: 10, Max: 13},
	{Code: "+95", Name: "缅甸", Min: 9, Max: 10},
	{Code: "+63", Name: "菲律宾", Min: 7, Max: 10},
	{Code: "+84", Name: "越南", Min: 9, Max: 10},
	{Code: "+855", Name: "柬埔寨", Min: 8, Max: 9},
	{Code: "+81", Name: "日本", Min: 9, Max: 11},
	{Code: "+82", Name: "韩国", Min: 8, Max: 11},
	{Code: "+971", Name: "阿拉伯联合酋长国", Min: 9, Max: 9},
}

var accountPhoneDigitsRE = regexp.MustCompile(`^[0-9]+$`)

func accountPhoneCountryForCode(code string) (accountPhoneCountry, bool) {
	code = strings.TrimSpace(code)
	for _, country := range accountPhoneCountries {
		if country.Code == code {
			return country, true
		}
	}
	return accountPhoneCountry{}, false
}

func normalizeAccountPhone(countryCode, local string) (string, error) {
	countryCode = strings.TrimSpace(countryCode)
	if countryCode == "" {
		countryCode = "+86"
	}
	if !strings.HasPrefix(countryCode, "+") {
		countryCode = "+" + countryCode
	}
	country, ok := accountPhoneCountryForCode(countryCode)
	if !ok {
		return "", errors.New("暂不支持该国家或地区的手机号")
	}
	local = strings.TrimSpace(local)
	if !accountPhoneDigitsRE.MatchString(local) || len(local) < country.Min || len(local) > country.Max || len(countryCode[1:])+len(local) > 15 {
		if country.Code == "+86" {
			return "", errors.New("请输入正确的11位中国大陆手机号")
		}
		return "", errors.New("请输入正确的" + country.Name + "手机号")
	}
	if country.Code == "+86" && !regexp.MustCompile(`^1[3-9][0-9]{9}$`).MatchString(local) {
		return "", errors.New("请输入正确的11位中国大陆手机号")
	}
	return country.Code + local, nil
}

// Existing internal callers historically passed a mainland local number. Keep
// that form working while making every new login session canonical E.164.
func canonicalAccountPhone(phone string) (string, error) {
	phone = strings.TrimSpace(phone)
	if strings.HasPrefix(phone, "+") {
		codes := make([]string, 0, len(accountPhoneCountries))
		for _, country := range accountPhoneCountries {
			codes = append(codes, country.Code)
		}
		sort.Slice(codes, func(i, j int) bool { return len(codes[i]) > len(codes[j]) })
		for _, code := range codes {
			if strings.HasPrefix(phone, code) {
				return normalizeAccountPhone(code, phone[len(code):])
			}
		}
		return "", errors.New("暂不支持该国家或地区的手机号")
	}
	return normalizeAccountPhone("+86", phone)
}

func accountPhoneCountryCode(phone string) string {
	phone, err := canonicalAccountPhone(phone)
	if err != nil {
		return "+86"
	}
	for _, country := range accountPhoneCountries {
		if strings.HasPrefix(phone, country.Code) {
			return country.Code
		}
	}
	return "+86"
}

// Keep storage and UI identity in compact E.164. Only Passport's mobile
// field uses the grouping recovered from v1.2.4 mobileWithCode/formatLocal.
func passportWirePhone(phone string) string {
	canonical, err := canonicalAccountPhone(phone)
	if err != nil {
		return phone
	}
	code := accountPhoneCountryCode(canonical)
	if code == "+86" {
		return canonical
	}
	country, _ := accountPhoneCountryForCode(code)
	local := strings.TrimPrefix(canonical, code)
	var widths []int
	switch {
	case country.Max == 10:
		widths = []int{3, 4, 3}
	case country.Max == 11:
		widths = []int{3, 4, 4}
	default:
		width := 3
		if country.Max%4 == 0 {
			width = 4
		}
		for left := country.Max; left > 0; left -= width {
			widths = append(widths, width)
		}
	}
	var groups []string
	for _, width := range widths {
		if local == "" {
			break
		}
		if width > len(local) {
			width = len(local)
		}
		groups = append(groups, local[:width])
		local = local[width:]
	}
	return code + strings.Join(groups, " ")
}
