use crate::money::Tone;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// 菜单栏上的今日盈亏。浅色用工作台涨跌色，深色用深色主题的涨跌色。
pub fn render_status(text: &str, tone: Tone, appearance: Appearance) -> RgbaImage {
    let color = match (appearance, tone) {
        (Appearance::Light, Tone::Up) => [0x98, 0x2c, 0x26, 0xff],
        (Appearance::Light, Tone::Down) => [0x16, 0x61, 0x53, 0xff],
        (Appearance::Dark, Tone::Up) => [0xff, 0xa1, 0x84, 0xff],
        (Appearance::Dark, Tone::Down) => [0x8e, 0xd7, 0xab, 0xff],
    };
    let scale = 2u32;
    let glyph_w = 5u32;
    let glyph_h = 7u32;
    let advance = (glyph_w + 1) * scale;
    let glyphs: Vec<[u8; 7]> = text.chars().filter_map(glyph_bits).collect();
    let count = glyphs.len().max(1) as u32;
    let width = advance * count + scale;
    let height = glyph_h * scale + scale * 2;
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for (index, bits) in glyphs.iter().enumerate() {
        let origin_x = scale + index as u32 * advance;
        for row in 0..7usize {
            for col in 0..5usize {
                if bits[row] & (1 << (4 - col)) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let x = origin_x + (col as u32) * scale + dx;
                        let y = scale + (row as u32) * scale + dy;
                        let offset = ((y * width + x) * 4) as usize;
                        rgba[offset..offset + 4].copy_from_slice(&color);
                    }
                }
            }
        }
    }
    RgbaImage { width, height, rgba }
}

fn glyph_bits(ch: char) -> Option<[u8; 7]> {
    Some(match ch {
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
        '3' => [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
        '+' => [0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00100, 0b00000],
        '-' => [0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000, 0b00000],
        ',' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100, 0b01000],
        '.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
        ' ' => [0, 0, 0, 0, 0, 0, 0],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_color(image: &RgbaImage, color: [u8; 4]) -> bool {
        image.rgba.chunks(4).any(|pixel| pixel == color)
    }

    #[test]
    fn positive_is_red_and_negative_is_green() {
        let up = render_status("+1", Tone::Up, Appearance::Light);
        let down = render_status("-2", Tone::Down, Appearance::Light);
        assert!(has_color(&up, [0x98, 0x2c, 0x26, 0xff]));
        assert!(!has_color(&up, [0x16, 0x61, 0x53, 0xff]));
        assert!(has_color(&down, [0x16, 0x61, 0x53, 0xff]));
        assert!(!has_color(&down, [0x98, 0x2c, 0x26, 0xff]));
        let dark = render_status("+1", Tone::Up, Appearance::Dark);
        assert!(has_color(&dark, [0xff, 0xa1, 0x84, 0xff]));
        assert!(up.width > 8 && up.height >= 16);
        assert_eq!(up.rgba.len(), (up.width * up.height * 4) as usize);
    }
}
