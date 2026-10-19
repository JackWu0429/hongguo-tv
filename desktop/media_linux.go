//go:build linux

package main

/*
#cgo linux pkg-config: gtk+-3.0
#cgo !webkit2_41 pkg-config: webkit2gtk-4.0
#cgo webkit2_41 pkg-config: webkit2gtk-4.1
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

static gboolean allow_app_media(WebKitWebView *view, WebKitPolicyDecision *decision,
                               WebKitPolicyDecisionType type, gpointer unused) {
    if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION)
        return FALSE;
    WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(
        WEBKIT_NAVIGATION_POLICY_DECISION(decision));
    const gchar *uri = webkit_uri_request_get_uri(webkit_navigation_action_get_request(action));
    if (!uri || !g_str_has_prefix(uri, "wails://wails/"))
        return FALSE;
    WebKitWebsitePolicies *policies = webkit_website_policies_new_with_policies(
        "autoplay", WEBKIT_AUTOPLAY_ALLOW, NULL);
    webkit_policy_decision_use_with_policies(decision, policies);
    g_object_unref(policies);
    return TRUE;
}

static void configure_media_widget(GtkWidget *widget, gpointer unused) {
    if (WEBKIT_IS_WEB_VIEW(widget)) {
        // The app controls its own source and playback lifecycle. Allow an
        // asynchronous card/episode load to start audible media on Linux too.
        WebKitSettings *settings = webkit_web_view_get_settings(WEBKIT_WEB_VIEW(widget));
        webkit_settings_set_media_playback_requires_user_gesture(settings, FALSE);
        if (!g_object_get_data(G_OBJECT(widget), "hongguo-autoplay-policy")) {
            g_signal_connect(widget, "decide-policy", G_CALLBACK(allow_app_media), NULL);
            g_object_set_data(G_OBJECT(widget), "hongguo-autoplay-policy", GINT_TO_POINTER(1));
        }
    }
    if (GTK_IS_CONTAINER(widget))
        gtk_container_foreach(GTK_CONTAINER(widget), configure_media_widget, NULL);
}
static gboolean configure_media_on_gtk_thread(gpointer unused) {
    GList *windows = gtk_window_list_toplevels();
    for (GList *item = windows; item; item = item->next)
        configure_media_widget(GTK_WIDGET(item->data), NULL);
    g_list_free(windows);
    return G_SOURCE_REMOVE;
}
static void schedule_media_configuration(void) {
    g_idle_add(configure_media_on_gtk_thread, NULL);
}
*/
import "C"

func configureDesktopMedia() { C.schedule_media_configuration() }
