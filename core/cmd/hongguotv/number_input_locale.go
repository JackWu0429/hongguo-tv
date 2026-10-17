package main

import (
	"fmt"
	"strings"
)

// numberInputLocale contains the copy for the short-lived phone/TV input page.
// It is kept separate from the HTML template so adding another locale does not
// require changing the page structure or its validation flow.
type numberInputLocale struct {
	DocumentTitle string
	ExpiredTitle  string
	ExpiredCopy   string
	CompleteTitle string

	CompleteSearchCopy  string
	CompleteDanmakuCopy string
	CompleteAccountCopy string

	SearchTitle   string
	DanmakuTitle  string
	PhoneTitle    string
	CodeTitle     string
	SearchCopy    string
	DanmakuCopy   string
	NumberCopy    string
	SearchLabel   string
	DanmakuLabel  string
	PhoneLabel    string
	CodeLabel     string
	SearchHint    string
	DanmakuHint   string
	NumberHint    string
	HintPrefix    string
	SearchError   string
	DanmakuError  string
	GenericError  string
	SearchInput   string
	DanmakuInput  string
	SearchSubmit  string
	DanmakuSubmit string
	NumberSubmit  string
}

var numberInputLocales = map[string]numberInputLocale{
	"zh-CN": {
		DocumentTitle:       "红果短剧 · 手机输入",
		ExpiredTitle:        "输入已结束",
		ExpiredCopy:         "请在电视上重新打开扫码输入，再扫描新的二维码。",
		CompleteTitle:       "已发送到电视",
		CompleteSearchCopy:  "请回到电视查看搜索结果。",
		CompleteDanmakuCopy: "弹幕内容已回到电视，请确认无误后发送。",
		CompleteAccountCopy: "请回到电视继续操作。此页面不会发送短信或登录账号。",
		SearchTitle:         "输入剧名或关键词",
		DanmakuTitle:        "输入弹幕",
		PhoneTitle:          "输入手机号（%s）",
		CodeTitle:           "输入验证码",
		SearchCopy:          "输入或粘贴剧名，发送后在电视上搜索。",
		DanmakuCopy:         "输入或粘贴弹幕，完成后回填电视。",
		NumberCopy:          "填写或粘贴数字，点击完成后回填电视。",
		SearchLabel:         "剧名 / 关键词",
		DanmakuLabel:        "弹幕内容",
		PhoneLabel:          "手机号（%s）",
		CodeLabel:           "短信验证码",
		SearchHint:          "正常完成的搜索会保存在电视的最近搜索中。",
		DanmakuHint:         "内容只回填到当前弹幕输入框，不会自动发送。",
		NumberHint:          "数字仅用于本次输入，不会保存。",
		HintPrefix:          "手机和电视需在同一局域网。二维码5分钟有效，电视关闭输入后立即失效。",
		SearchError:         "请输入不超过100字的剧名或关键词",
		DanmakuError:        "请输入不超过100字的弹幕",
		GenericError:        "请填写正确的数字后重试",
		SearchInput:         "输入或粘贴剧名",
		DanmakuInput:        "输入或粘贴弹幕",
		SearchSubmit:        "发送并搜索",
		DanmakuSubmit:       "弹幕回填电视",
		NumberSubmit:        "完成，回填电视",
	},
}

func numberInputLocaleFor(acceptLanguage, kind, countryCode string) numberInputLocale {
	locale := numberInputLocales["zh-CN"]
	// Prefer an exact locale, then its language family. Unknown languages
	// safely use the source locale until a matching resource is shipped.
	for _, part := range strings.Split(strings.ToLower(acceptLanguage), ",") {
		language := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if language == "" {
			continue
		}
		if candidate, ok := numberInputLocales[language]; ok {
			locale = candidate
			break
		}
		base := strings.SplitN(language, "-", 2)[0]
		matched := false
		for key, candidate := range numberInputLocales {
			if strings.SplitN(strings.ToLower(key), "-", 2)[0] == base {
				locale = candidate
				matched = true
				break
			}
		}
		if matched {
			break
		}
	}
	locale.PhoneTitle = fmt.Sprintf(locale.PhoneTitle, countryCode)
	locale.PhoneLabel = fmt.Sprintf(locale.PhoneLabel, countryCode)
	return locale
}

func (t numberInputLocale) Title(kind string) string {
	switch kind {
	case "search":
		return t.SearchTitle
	case "danmaku":
		return t.DanmakuTitle
	case "phone":
		return t.PhoneTitle
	default:
		return t.CodeTitle
	}
}

func (t numberInputLocale) Description(kind string) string {
	switch kind {
	case "search":
		return t.SearchCopy
	case "danmaku":
		return t.DanmakuCopy
	default:
		return t.NumberCopy
	}
}

func (t numberInputLocale) Label(kind string) string {
	switch kind {
	case "search":
		return t.SearchLabel
	case "danmaku":
		return t.DanmakuLabel
	case "phone":
		return t.PhoneLabel
	default:
		return t.CodeLabel
	}
}

func (t numberInputLocale) Placeholder(kind string) string {
	if kind == "search" {
		return t.SearchInput
	}
	if kind == "danmaku" {
		return t.DanmakuInput
	}
	return ""
}

func (t numberInputLocale) Submit(kind string) string {
	switch kind {
	case "search":
		return t.SearchSubmit
	case "danmaku":
		return t.DanmakuSubmit
	default:
		return t.NumberSubmit
	}
}

func (t numberInputLocale) Hint(kind string) string {
	suffix := t.NumberHint
	if kind == "search" {
		suffix = t.SearchHint
	} else if kind == "danmaku" {
		suffix = t.DanmakuHint
	}
	return t.HintPrefix + suffix
}

func (t numberInputLocale) CompleteCopy(kind string) string {
	switch kind {
	case "search":
		return t.CompleteSearchCopy
	case "danmaku":
		return t.CompleteDanmakuCopy
	default:
		return t.CompleteAccountCopy
	}
}
