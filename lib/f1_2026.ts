// lib/f1_2026.ts
export type F1Driver = {
  code: string;   // 3-letter code
  name: string;
  teamId: string;
  teamName: string;
};

export type F1Team = {
  id: string;
  name: string;
  color: string; // hex (indicatief)
};

export const F1_TEAMS_2026: F1Team[] = [
  { id: "alpine", name: "BWT Alpine Formula One Team", color: "#0093CC" },
  { id: "aston", name: "Aston Martin Aramco Formula One Team", color: "#006F62" },
  { id: "audi", name: "Audi Revolut F1 Team", color: "#111111" },
  { id: "cadillac", name: "Cadillac Formula 1 Team", color: "#001F5B" },
  { id: "ferrari", name: "Scuderia Ferrari HP", color: "#DC0000" },
  { id: "haas", name: "TGR Haas F1 Team", color: "#B6BABD" },
  { id: "mclaren", name: "McLaren", color: "#FF8000" },
  { id: "mercedes", name: "Mercedes", color: "#00D2BE" },
  { id: "rb", name: "Oracle Red Bull Racing", color: "#1E41FF" },
  { id: "racingbulls", name: "Visa Cash App Racing Bulls F1 Team", color: "#2B2D42" },
  { id: "williams", name: "Atlassian Williams F1 Team", color: "#005AFF" },
];

export const F1_DRIVERS_2026: F1Driver[] = [
  // ✅ Oracle Red Bull Racing (volgens jouw screenshot)
  { code: "VER", name: "Max Verstappen", teamId: "rb", teamName: "Oracle Red Bull Racing" },
  { code: "HAD", name: "Isack Hadjar", teamId: "rb", teamName: "Oracle Red Bull Racing" },

  // Ferrari HP
  { code: "LEC", name: "Charles Leclerc", teamId: "ferrari", teamName: "Scuderia Ferrari HP" },
  { code: "HAM", name: "Lewis Hamilton", teamId: "ferrari", teamName: "Scuderia Ferrari HP" },

  // ✅ Atlassian Williams (volgens jouw screenshot)
  { code: "ALB", name: "Alex Albon", teamId: "williams", teamName: "Atlassian Williams F1 Team" },
  { code: "SAI", name: "Carlos Sainz", teamId: "williams", teamName: "Atlassian Williams F1 Team" },

  // ✅ Visa Cash App Racing Bulls (volgens jouw screenshot)
  { code: "LIN", name: "Arvid Lindblad", teamId: "racingbulls", teamName: "Visa Cash App Racing Bulls F1 Team" },
  { code: "LAW", name: "Liam Lawson", teamId: "racingbulls", teamName: "Visa Cash App Racing Bulls F1 Team" },

  // ✅ Aston Martin (volgens jouw screenshot)
  { code: "STR", name: "Lance Stroll", teamId: "aston", teamName: "Aston Martin Aramco Formula One Team" },
  { code: "ALO", name: "Fernando Alonso", teamId: "aston", teamName: "Aston Martin Aramco Formula One Team" },

  // ✅ Haas (volgens jouw screenshot)
  { code: "OCO", name: "Esteban Ocon", teamId: "haas", teamName: "TGR Haas F1 Team" },
  { code: "BEA", name: "Oliver Bearman", teamId: "haas", teamName: "TGR Haas F1 Team" },

  // ✅ Audi Revolut (volgens jouw screenshot)
  { code: "HUL", name: "Nico Hulkenberg", teamId: "audi", teamName: "Audi Revolut F1 Team" },
  { code: "BOR", name: "Gabriel Bortoleto", teamId: "audi", teamName: "Audi Revolut F1 Team" },

  // ✅ Alpine (volgens jouw screenshot)
  { code: "GAS", name: "Pierre Gasly", teamId: "alpine", teamName: "BWT Alpine Formula One Team" },
  { code: "COL", name: "Franco Colapinto", teamId: "alpine", teamName: "BWT Alpine Formula One Team" },

  // ✅ Cadillac (volgens jouw screenshot)
  { code: "PER", name: "Sergio Perez", teamId: "cadillac", teamName: "Cadillac Formula 1 Team" },
  { code: "BOT", name: "Valtteri Bottas", teamId: "cadillac", teamName: "Cadillac Formula 1 Team" },

  // --- Overige teams (laten we staan tot jij de volledige “leidende” lijst deelt) ---
  // McLaren
  { code: "NOR", name: "Lando Norris", teamId: "mclaren", teamName: "McLaren" },
  { code: "PIA", name: "Oscar Piastri", teamId: "mclaren", teamName: "McLaren" },

  // Mercedes
  { code: "RUS", name: "George Russell", teamId: "mercedes", teamName: "Mercedes" },
  { code: "ANT", name: "Andrea Kimi Antonelli", teamId: "mercedes", teamName: "Mercedes" },
];

export function getTeamColorByDriverCode(code: string): string {
  const d = F1_DRIVERS_2026.find((x) => x.code === code);
  if (!d) return "#999999";
  return F1_TEAMS_2026.find((t) => t.id === d.teamId)?.color ?? "#999999";
}
