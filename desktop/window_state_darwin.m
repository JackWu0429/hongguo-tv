//go:build darwin

#import <Cocoa/Cocoa.h>

// WKWebView briefly reports document.hidden during native full-screen Space
// transitions. Query actual minimisation/app hiding on Cocoa's main thread.
int hongguoWindowHidden(void) {
    __block int hidden = 0;
    void (^readState)(void) = ^{
        hidden = [NSApp isHidden];
        for (NSWindow *window in [NSApp windows]) {
            if ([NSStringFromClass([window class]) isEqualToString:@"WailsWindow"]) {
                hidden = hidden || [window isMiniaturized];
                break;
            }
        }
    };
    if ([NSThread isMainThread]) readState();
    else dispatch_sync(dispatch_get_main_queue(), readState);
    return hidden;
}
