package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// Read-only opt-in probe. Logs public schema/counts only, never account identity.
func TestLiveCalendarContract(t *testing.T) {
	dir := os.Getenv("HONGGUO_AUTH_READ_PROBE_DIR")
	if dir == "" {
		t.Skip("explicit authenticated read regression only")
	}
	b, e := os.ReadFile(filepath.Join(dir, "account.json"))
	if e != nil {
		t.Fatal("session unavailable")
	}
	var disk accountDisk
	if json.Unmarshal(b, &disk) != nil || disk.Profile == nil {
		t.Fatal("not logged in")
	}
	c := newPassportClient(disk.Session)
	c.uid = disk.Profile.UID
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	date := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("20060102")
	for _, gender := range []string{"2", "1", "0", "3"} {
		q := url.Values{"tab_type": {"5"}, "tab_style": {"2"}, "active_panel": {"6"}, "gender_type": {gender}, "need_calendar_schema": {"true"}, "target_date": {date}, "offset": {"0"}, "subscribe_offset": {"0"}}
		p, e := c.cloudJSON(ctx, "/reading/user/subscribe/list/v1/", http.MethodGet, q, nil)
		if e != nil {
			t.Fatal("calendar read failed")
		}
		d := passportData(p)
		rows, _ := d["subscribe_items"].([]any)
		ids := []string{}
		genderFields := map[string]int{}
		for _, v := range rows {
			r, _ := asMap(v)
			ids = append(ids, asString(r["item_id"]))
			for k, v := range r {
				if strings.Contains(k, "gender") {
					genderFields[k+"="+asString(v)]++
				}
			}
		}
		hash := sha256.Sum256([]byte(strings.Join(ids, ",")))
		t.Logf("gender=%s rows=%d fingerprint=%x gender_fields=%v", gender, len(rows), hash[:6], genderFields)
		if gender == "2" {
			for _, k := range []string{"calendar_schema", "gender_selector", "gender_types"} {
				if x, ok := asMap(d[k]); ok {
					keys := []string{}
					for key := range x {
						keys = append(keys, key)
					}
					sort.Strings(keys)
					t.Logf("%s fields=%v", k, keys)
				}
			}
			if len(rows) > 0 {
				r, _ := asMap(rows[0])
				keys := []string{}
				for k := range r {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				t.Logf("row fields=%v online=%s schedule=%s", keys, asString(r["is_online"]), asString(r["schedule_publish_time"]))
			}
		}
	}
}
