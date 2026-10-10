package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
)

func TestFollowUpdatesUsesCursorAndMacShape(t *testing.T) {
	calls := 0
	c, closeServer := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
		calls++
		q := r.URL.Query()
		if q.Get("tab_type") != "14" || q.Get("count") != "20" {
			t.Fatalf("wrong follow query: %v", q)
		}
		if calls == 1 && q.Get("cursor") != "" {
			t.Fatalf("initial follow cursor = %q", q.Get("cursor"))
		}
		if calls == 2 && q.Get("cursor") != "cursor-2" {
			t.Fatalf("follow cursor not resumed: %q", q.Get("cursor"))
		}
		if calls == 1 {
			ioJSON(w, `{"code":0,"data":{"cursor":"cursor-2","has_more":true,"mix_data":[{"video_id":"7690163276214176792","common":{"title":"追更剧","cover":"https://example.com/cover.jpg","video_content_type":1},"expand":{"episode_cnt":12,"latest_watched_vid_index":4,"has_watched_latest_episode":false,"show_update_frequency":"每日更新"}}]}}`)
			return
		}
		ioJSON(w, `{"code":0,"data":{"cursor":"cursor-2","has_more":true,"mix_data":[]}}`)
	})
	defer closeServer()

	first, err := c.FollowUpdates(context.Background(), url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	if !first.HasMore || first.NextCursor != "cursor-2" || len(first.Items) != 1 {
		t.Fatalf("bad first follow page: %+v", first)
	}
	item := first.Items[0]
	if item.SeriesID != "7690163276214176792" || item.Title != "追更剧" || item.EpisodeCount != 12 || item.LatestWatchedEpisode != 4 || item.ShowUpdateFrequency != "每日更新" || !item.Followed {
		t.Fatalf("bad mac follow model: %+v", item)
	}
	second, err := c.FollowUpdates(context.Background(), url.Values{"cursor": {first.NextCursor}})
	if err != nil {
		t.Fatal(err)
	}
	if second.HasMore || second.NextCursor != "cursor-2" {
		t.Fatalf("stalled follow cursor was not stopped: %+v", second)
	}
}

func TestSetFollowUpdateUsesConfirmedSubscribeMutation(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		c, closeServer := listFixtureClient(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/reading/user/subscribe/delete/v" {
				t.Fatalf("wrong follow mutation route: %s %s", r.Method, r.URL.Path)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			want := 2.0
			if enabled {
				want = 1
			}
			if body["book_id"] != "7690163276214176792" || body["series_id"] != "7690163276214176792" || body["book_type"] != wantBookType || body["op_type"] != want {
				t.Fatalf("wrong follow mutation body: %#v", body)
			}
			ioJSON(w, `{"code":0,"data":{}}`)
		})
		if err := c.SetFollowUpdate(context.Background(), "7690163276214176792", enabled); err != nil {
			t.Fatal(err)
		}
		closeServer()
	}
}

const wantBookType = 2.0
