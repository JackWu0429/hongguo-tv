package main

import "testing"

func TestNormalizeAccountPhoneByCountry(t *testing.T) {
	tests := []struct {
		code, local, want string
		valid             bool
	}{
		{"", "13800000000", "+8613800000000", true},
		{"+86", "12800000000", "", false},
		{"+852", "61234567", "+85261234567", true},
		{"852", "61234567", "+85261234567", true},
		{"+886", "912345678", "+886912345678", true},
		{"+81", "9012345678", "+819012345678", true},
		{"+852", "1234567", "", false},
		{"+999", "12345678", "", false},
	}
	for _, test := range tests {
		got, err := normalizeAccountPhone(test.code, test.local)
		if (err == nil) != test.valid || got != test.want {
			t.Errorf("normalizeAccountPhone(%q, %q) = %q, %v; want %q valid=%v", test.code, test.local, got, err, test.want, test.valid)
		}
	}
}

func TestCanonicalAccountPhoneAndMask(t *testing.T) {
	for _, test := range []struct{ input, canonical, mask string }{
		{"13800000000", "+8613800000000", "138****0000"},
		{"+85261234567", "+85261234567", "+85261****67"},
	} {
		got, err := canonicalAccountPhone(test.input)
		if err != nil || got != test.canonical {
			t.Fatalf("canonicalAccountPhone(%q) = %q, %v", test.input, got, err)
		}
		if masked := maskPhone(test.input); masked != test.mask {
			t.Errorf("maskPhone(%q) = %q, want %q", test.input, masked, test.mask)
		}
	}
}

func TestPassportFormUsesReferenceInternationalNumber(t *testing.T) {
	if got := passportForm("+85261234567").Get("mobile"); got != passportXOR("+8526123 4567") {
		t.Fatalf("passport form did not serialize the selected country number")
	}
}

func TestNumberInputPhoneValidationUsesCountryPolicy(t *testing.T) {
	if !validNumberInput("phone", "61234567", "+852") || validNumberInput("phone", "6123456", "+852") {
		t.Fatal("Hong Kong phone validation mismatch")
	}
	if !validNumberInput("phone", "13800000000") || validNumberInput("phone", "12800000000") {
		t.Fatal("mainland phone validation mismatch")
	}
}
