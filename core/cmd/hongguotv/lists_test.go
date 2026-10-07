package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func listFixtureClient(handler http.HandlerFunc) (*passportClient, func()) {
	s := httptest.NewServer(handler)
	c := newPassportClient(accountSession{DeviceID: "1234567890123456789", InstallID: "1234567890123456788", Cookies: map[string]string{}})
	c.base = s.URL
	c.http = s.Client()
	return c, s.Close
}
func TestOfficialListQueriesAndCursors(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("offset") != "24" || q.Get("session_id") != "calendar-session" {
			t.Error("lost cursor", q)
		}
		if q.Get("target_date") != "20261007" || q.Get("gender_type") != "1" || q.Get("subscribe_offset") != "24" || q.Get("tab_type") != "5" {
			t.Error("wrong calendar contract", q)
		}
		ioJSON(w, `{"code":0,"data":{"next_offset":25,"has_more":false,"session_id":"s","calendar_schema":{"date_list":["20261007"],"default_date":"20261007","current_date":"20261007"},"subscribe_items":[{"item_id":"7692049770637954110","name":"待上线剧","cover":"https://example.com/cover.jpg","is_online":false,"has_subscribed":true,"schedule_publish_time":1791364920},{"item_id":"0","is_online":true,"subscribe_data":{"series_id":7692318643031395390,"title":"已上线剧","episode_cnt":69}}]}}`)
	})
	defer close()
	out, err := c.SubscriptionList(context.Background(), url.Values{"offset": {"24"}, "session_id": {"calendar-session"}, "date": {"20261007"}, "gender": {"1"}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 2 || !out.Items[0].Upcoming || !out.Items[0].Reserved || out.Items[1].SeriesID != "7692318643031395390" || out.Items[1].ReservationID != "" || out.NextOffset != 25 || out.Calendar.DefaultDate != "20261007" {
		t.Fatalf("bad normalization: %+v", out)
	}
}
func TestReservationWriteUsesItemIDAndConfirmedResponse(t *testing.T) {
	for _, reserve := range []bool{true, false} {
		c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.Path != "/reading/bookapi/search/uncover_subscribe/v" {
				t.Error("wrong route")
			}
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			op := float64(2)
			if reserve {
				op = 1
			}
			if body["item_id"] != "7692049770637954110" || body["item_type"] != float64(1) || body["op_type"] != op {
				t.Error("wrong body", body)
			}
			shark, _ := asMap(body["shark_param"])
			if shark["enter_from"] != "BulletActivity" {
				t.Error("missing shark metadata")
			}
			ioJSON(w, `{"code":100,"data":{}}`)
		})
		if err := c.SetReservation(context.Background(), "7692049770637954110", reserve); err == nil {
			t.Error("unconfirmed write accepted")
		}
		close()
	}
}

func TestReservationCountersAndMissingCursor(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("is_online") != "true" || r.URL.Query().Get("limit") != "20" {
			t.Error("wrong reservation mode")
		}
		ioJSON(w, `{"code":0,"data":{"online_total_count":48,"offline_total_count":0,"has_more":true,"subscribe_items":[{"item_id":"7692049770637954110","is_online":true,"subscribe_data":{"series_id":"7690163276214176792","title":"已上线剧","episode_cnt":80}}]}}`)
	})
	defer close()
	out, err := c.SubscriptionList(context.Background(), url.Values{"mode": {"online"}, "offset": {"20"}}, false)
	if err != nil || out.OnlineTotal == nil || *out.OnlineTotal != 48 || out.OfflineTotal == nil || *out.OfflineTotal != 0 || out.NextOffset != 40 || !out.HasMore || len(out.Items) != 1 || out.Items[0].Upcoming {
		t.Fatalf("bad counts/cursor: %+v %v", out, err)
	}
}
func TestSearchGroupingAndPagination(t *testing.T) {
	p := map[string]any{}
	d := json.NewDecoder(strings.NewReader(`{"data":{"search_tabs":[{"tab_type":1,"data":[]},{"tab_type":11,"has_more":true,"next_offset":"100","search_id":"search-s","passback":"p","data":[{"video_data":[{"series_id":7690163276214176792,"title":"第十三季","episode_cnt":209}]},{"lynx_data":"{\"items\":[{\"video_data\":[{\"series_id\":\"7690163276214176793\",\"title\":\"第二季\",\"episode_cnt\":50}]}]}"}]}]}}`))
	d.UseNumber()
	d.Decode(&p)
	out, e := parseSearchList(p, 0)
	if e != nil {
		t.Fatal(e)
	}
	if len(out.Items) != 2 || out.Items[0].SeriesID != "7690163276214176792" || out.SearchID != "search-s" || out.Passback != "p" || out.NextOffset != 100 || !out.HasMore {
		t.Fatalf("bad search: %+v", out)
	}
	out, e = parseSearchList(p, 100)
	if e != nil || out.HasMore {
		t.Error("stalled cursor was not stopped")
	}
}
func TestListsArePrivateAndReservationsRequireLogin(t *testing.T) {
	m := fixtureAccount(t, func(w http.ResponseWriter, r *http.Request) { t.Error("guest must not request reservations") })
	s := &server{accounts: m}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/lists/", s.lists)
	mux.HandleFunc("/api/v1/reservation", s.reservation)
	for _, path := range []string{"/api/v1/lists/reservations", "/api/v1/reservation"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8797"+path, nil)
		r.RemoteAddr = "127.0.0.1:4567"
		r.Header.Set("Origin", "https://evil.example")
		w := httptest.NewRecorder()
		s.withCORS(mux).ServeHTTP(w, r)
		if w.Code != 403 {
			t.Errorf("%s exposed", path)
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8797/api/v1/lists/reservations", nil)
	r.RemoteAddr = "127.0.0.1:4567"
	w := httptest.NewRecorder()
	s.withCORS(mux).ServeHTTP(w, r)
	if w.Code != 401 {
		t.Errorf("guest reservations = %d", w.Code)
	}
	if _, _, e := m.listClient(true); e != errListLogin {
		t.Error(e)
	}
	_, g, e := m.listClient(false)
	if e != nil {
		t.Fatal(e)
	}
	m.mu.Lock()
	m.generation++
	m.mu.Unlock()
	if m.sameGeneration(g) {
		t.Error("old account generation accepted")
	}
}
func TestRankJSONSelectorsAndActors(t *testing.T) {
	c, close := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("tab_type") != "18" || q.Get("filter_ids") != "7690163276214176792" || q.Get("selected_items") != "ranklist_celebrity" {
			t.Error("wrong rank paging", q)
		}
		ioJSON(w, `{"code":0,"data":{"has_more":true,"next_offset":20,"cell_view":{"cell_selector":{"outer_row":{"items":[{"selector_item_id":"ranklist_celebrity","show_name":"演员","sub_cell_selector":{"outer_row":{"items":[{"selector_item_id":"ranklist_actor_fans","show_name":"星光榜"}]}}}]}},"cell_data":[{"ugc_user_data":[{"user_info":{"base_info":{"actor_id_str":"1234567890123456789","user_name":"测试演员","user_avatar":"https://example.com/a.jpg"}},"intro":"演员简介"}]}]}}}`)
	})
	defer close()
	out, e := c.RankList(context.Background(), url.Values{"offset": {"10"}, "shown": {"7690163276214176792"}, "rank": {"ranklist_celebrity"}, "rank_sub": {"ranklist_actor_fans"}})
	if e != nil {
		t.Fatal(e)
	}
	if len(out.Ranks) != 1 || len(out.Ranks[0].Children) != 1 || len(out.Items) != 1 || out.Items[0].ActorID == "" || validID(out.Items[0].SeriesID) {
		t.Fatalf("actor mapped to playable drama: %+v", out)
	}
}
