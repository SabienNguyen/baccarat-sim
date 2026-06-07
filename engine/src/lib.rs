//! Baccarat (Punto Banco) rules engine — pure logic, no UI.

pub mod card;
pub mod hand;
pub mod rules;
pub mod round;

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
