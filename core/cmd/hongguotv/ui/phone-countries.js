(function (root) {
  'use strict';
  root.HongguoPhoneCountries = [
    { code: '+86', localeKey: 'country.mainlandChina', minLength: 11, maxLength: 11 },
    { code: '+852', localeKey: 'country.hongKong', minLength: 8, maxLength: 8 },
    { code: '+853', localeKey: 'country.macao', minLength: 8, maxLength: 8 },
    { code: '+886', localeKey: 'country.taiwan', minLength: 9, maxLength: 9 },
    { code: '+60', localeKey: 'country.malaysia', minLength: 7, maxLength: 10 },
    { code: '+65', localeKey: 'country.singapore', minLength: 8, maxLength: 8 },
    { code: '+62', localeKey: 'country.indonesia', minLength: 8, maxLength: 12 },
    { code: '+95', localeKey: 'country.myanmar', minLength: 7, maxLength: 10 },
    { code: '+63', localeKey: 'country.philippines', minLength: 10, maxLength: 10 },
    { code: '+84', localeKey: 'country.vietnam', minLength: 9, maxLength: 10 },
    { code: '+855', localeKey: 'country.cambodia', minLength: 8, maxLength: 9 },
    { code: '+81', localeKey: 'country.japan', minLength: 10, maxLength: 10 },
    { code: '+82', localeKey: 'country.korea', minLength: 9, maxLength: 10 },
    { code: '+971', localeKey: 'country.uae', minLength: 9, maxLength: 9 }
  ];
  root.HongguoPhoneCountryName = function (country) {
    if (!country) return '';
    if (root.HongguoI18n && country.localeKey) return root.HongguoI18n.t(country.localeKey);
    return country.name || country.code || '';
  };
}(typeof window !== 'undefined' ? window : this));
