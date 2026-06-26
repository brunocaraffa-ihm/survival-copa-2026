// 2026 FIFA World Cup group draw (letter -> 4 teams).
//
// Derived from the OFFICIAL final draw (held 2025-12-05, Washington D.C.) and
// VALIDATED against this project's `matches` table on 2026-06-26:
//   - 48 distinct GROUP_STAGE teams in the DB.
//   - 72 group-stage matches forming exactly 12 connected clusters of 4 teams,
//     each a complete round-robin (all 4 teams play each other -> 6 pairings).
//   - Every cluster maps to a unique letter A-L; all 4 teams match the official
//     draw after name normalization.
//
// Team strings below are the EXACT names as stored in the DB (football-data
// naming). Notable DB <-> official-draw aliases:
//   South Korea = Korea Republic | Turkey = Türkiye | Ivory Coast = Côte d'Ivoire
//   Iran = IR Iran | United States = USA | Cape Verde Islands = Cabo Verde
//   Congo DR = DR Congo | Czechia = Czech Republic
//   Bosnia-Herzegovina = Bosnia and Herzegovina

export type GroupLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L'

/** Official WC2026 group → its 4 teams, using EXACT names as stored in the DB matches. */
export const WC2026_GROUPS: Record<GroupLetter, string[]> = {
  A: ['Mexico', 'South Africa', 'South Korea', 'Czechia'],
  B: ['Canada', 'Bosnia-Herzegovina', 'Qatar', 'Switzerland'],
  C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
  D: ['United States', 'Paraguay', 'Australia', 'Turkey'],
  E: ['Germany', 'Curaçao', 'Ivory Coast', 'Ecuador'],
  F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Spain', 'Cape Verde Islands', 'Saudi Arabia', 'Uruguay'],
  I: ['France', 'Senegal', 'Iraq', 'Norway'],
  J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
  K: ['Portugal', 'Congo DR', 'Uzbekistan', 'Colombia'],
  L: ['England', 'Croatia', 'Ghana', 'Panama'],
}
