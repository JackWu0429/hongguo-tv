package main

import "testing"

func TestNotificationStateNormalizesAndTrims(t *testing.T) {
	state := notificationState{Items: make([]NotificationItem, notificationItemLimit+3)}
	for i := range state.Items {
		state.Items[i].ID = string(rune('a'+i%26)) + ":" + string(rune(i))
	}
	state = normalizeNotificationState(state)
	if state.Version != notificationStateVersion || len(state.Follow) != 0 || len(state.Reservations) != 0 || len(state.Items) != notificationItemLimit {
		t.Fatalf("state was not normalized: %+v", state)
	}
}

func TestAppendNotificationDeduplicatesAndBounds(t *testing.T) {
	state := emptyNotificationState()
	item := NotificationItem{ID: "follow:1:2", Title: "测试短剧"}
	appendNotification(&state, item)
	appendNotification(&state, item)
	if len(state.Items) != 1 {
		t.Fatalf("duplicate notification appended: %+v", state.Items)
	}
	for i := 0; i < notificationItemLimit+5; i++ {
		appendNotification(&state, NotificationItem{ID: "id:" + string(rune(i+1))})
	}
	if len(state.Items) != notificationItemLimit || state.Items[len(state.Items)-1].ID == item.ID {
		t.Fatalf("notification limit/order failed: first=%v last=%v len=%d", state.Items[0].ID, state.Items[len(state.Items)-1].ID, len(state.Items))
	}
}

func TestNotificationPayloadCountsUnreadAndReportsStale(t *testing.T) {
	state := emptyNotificationState()
	state.LastCheckAt = 123
	state.Items = []NotificationItem{{ID: "1", Read: false}, {ID: "2", Read: true}}
	payload := notificationPayload(state, []string{"追更检查失败"})
	if !payload.OK || payload.UnreadCount != 1 || !payload.Stale || payload.Error == "" || payload.CheckedAt != 123 {
		t.Fatalf("bad notification payload: %+v", payload)
	}
}
