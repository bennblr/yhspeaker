# JavascriptInterface: методы вызываются из проверенной страницы сервера,
# обфускация имён сделала бы вызовы нестабильными.
-keepclassmembers class ru.la2speak.mobile.MobileBridge {
    public *;
}
-keep class ru.la2speak.mobile.MobileBridge { *; }
