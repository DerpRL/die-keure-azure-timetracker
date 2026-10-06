//! Byte-exact replicas of Swift standard-library behaviour that 1.14.x baked into persisted keys
//! or user-visible ordering. Pure functions, unit-tested against values printed by Swift 6.4.

use std::cmp::Ordering;

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// Swift's `"\(double)"` (`Double.description`): the shortest digits that round-trip, printed in
/// decimal with at least one fractional digit (`1759737600.0`), or in exponential form
/// (`1e+16`, `1e-05`) when the magnitude is above 2^53 or below 1e-4.
pub(crate) fn double_description(value: f64) -> String {
    if value.is_nan() {
        return "nan".into();
    }
    if value.is_infinite() {
        return if value > 0.0 { "inf" } else { "-inf" }.into();
    }
    if value == 0.0 {
        return if value.is_sign_negative() { "-0.0" } else { "0.0" }.into();
    }
    // Rust's `{:e}` prints the shortest round-trip digits as `d.ddde±x`, the same digits SwiftDtoa
    // chooses. Only the layout differs, so rebuild it the way Swift lays it out.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((scientific.as_str(), "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let sign = if value.is_sign_negative() { "-" } else { "" };
    // Swift's decimal exponent places the point before the first digit: 0.ddd × 10^e.
    let decimal_exponent = exponent + 1;
    if decimal_exponent < -3 || value.abs() > 9_007_199_254_740_992.0 {
        let mut out = format!("{sign}{}", &digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if exponent < 0 { '-' } else { '+' });
        out.push_str(&format!("{:02}", exponent.unsigned_abs()));
        out
    } else if decimal_exponent <= 0 {
        let zeros = "0".repeat(decimal_exponent.unsigned_abs() as usize);
        format!("{sign}0.{zeros}{digits}")
    } else {
        let point = decimal_exponent as usize;
        if point >= digits.len() {
            let zeros = "0".repeat(point - digits.len());
            format!("{sign}{digits}{zeros}.0")
        } else {
            format!("{sign}{}.{}", &digits[..point], &digits[point..])
        }
    }
}

/// Swift `String` `<`: Unicode canonical ordering, i.e. the scalar values of the NFC forms.
pub(crate) fn string_cmp(a: &str, b: &str) -> Ordering {
    if a.is_ascii() && b.is_ascii() {
        return a.cmp(b);
    }
    a.nfc().cmp(b.nfc())
}

/// Lower-case hexadecimal SHA-256 of the UTF-8 bytes (CryptoKit `SHA256.hash` + `%02x`).
pub(crate) fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest.iter() {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `(bit pattern, Swift "\(value)")`, printed by Swift 6.4 on macOS 27.
    const SWIFT_DESCRIPTIONS: &[(u64, &str)] = &[
        (4607182418800017408, "1.0"),
        (4591870180066957722, "0.1"),
        (4745167682448392192, "1759737600.0"),
        (4745167682450489344, "1759737600.5"),
        (4728057454355442549, "123456789.12345679"),
        (4831355200913801216, "1000000000000000.0"),
        (4845873199050653696, "9007199254740992.0"),
        (4850376798678024192, "1.8014398509481984e+16"),
        (4854880398305394688, "3.602879701896397e+16"),
        (4846369599423283200, "1e+16"),
        (4547007122018943789, "0.0001"),
        (4532020583610935537, "1e-05"),
        (4548684680454221981, "0.0001234"),
        (9223372036854775808, "-0.0"),
        (1, "5e-324"),
        (9218868437227405311, "1.7976931348623157e+308"),
        (4636737291354636288, "100.0"),
        (4921056587992461136, "1e+21"),
        (4508321993853365645, "2.5e-07"),
        (13968539719306313728, "-1759737600.75"),
        (4847542438873900484, "1.2345678901234568e+16"),
        (4562254508917369340, "0.001"),
        (4564560351926583034, "0.0015"),
        (0, "0.0"),
    ];

    #[test]
    fn double_description_matches_swift() {
        for (bits, expected) in SWIFT_DESCRIPTIONS {
            let value = f64::from_bits(*bits);
            assert_eq!(double_description(value), *expected, "value {value:e}");
        }
        assert_eq!(double_description(f64::NAN), "nan");
        assert_eq!(double_description(f64::INFINITY), "inf");
        assert_eq!(double_description(f64::NEG_INFINITY), "-inf");
    }

    #[test]
    fn string_cmp_uses_canonical_equivalence() {
        assert_eq!(string_cmp("Work", "Home"), Ordering::Greater);
        assert_eq!(string_cmp("B", "a"), Ordering::Less, "uppercase sorts before lowercase");
        // "é" precomposed and decomposed are equal in Swift.
        assert_eq!(string_cmp("Caf\u{e9}", "Cafe\u{301}"), Ordering::Equal);
        assert_eq!(string_cmp("Cafe", "Caf\u{e9}"), Ordering::Less);
    }

    #[test]
    fn sha256_hex_is_lowercase_hex() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
