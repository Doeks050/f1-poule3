// lib/f1_2026.ts

export type F1Team = {
  id: string;
  name: string;
  color: string; // hex (indicatief / UI)
};

export type F1Driver = {
  code: string; // 3-letter code (jij gebruikt dit in predictions)
  name: string;
  teamId: string;
  teamName: string;
};

export const F1_TEAMS_2026: F1Team[] = [
  { id: "rb", name: "Oracle Red Bull Racing", color: "#1E41FF" },
  { id: "ferrari", name: "Scuderia Ferrari HP", color: "#DC0000" },
  { id: "mclaren", name: "McLaren", color: "#FF8000" },
  { id: "mercedes", name: "Mercedes", color: "#00D2BE" },
  { id: "aston", name: "Aston Martin Aramco Formula One Team", color: "#006F62" },
  { id: "alpine", name: "BWT Alpine Formula One Team", color: "#0093CC" },
  { id: "williams", name: "Atlassian Williams F1 Team", color: "#005AFF" },
  { id: "haas", name: "TGR Haas F1 Team", color: "#B6BABD" },
  { id: "racingbulls", name: "Visa Cash App Racing Bulls F1 Team", color: "#2B2D42" },

  // 2026 changes
  { id: "audi", name: "Audi Revolut F1 Team", color: "#111111" },
  { id: "cadillac", name: "Cadillac", color: "#001F5B" },
];

// 2026 line-up (incl. Cadillac + Audi) zoals F1 publiceert. :contentReference[oaicite:1]{index=1}
export const F1_DRIVERS_2026: F1Driver[] = [
  // Red Bull
  { code: "VER", name: "Max Verstappen", teamId: "rb", teamName: "Oracle Red Bull Racing" },
  { code: "HAD", name: "Isack Hadjar", teamId: "rb", teamName: "Oracle Red Bull Racing" },

  // Ferrari
  { code: "LEC", name: "Charles Leclerc", teamId: "ferrari", teamName: "Scuderia Ferrari HP" },
  { code: "HAM", name: "Lewis Hamilton", teamId: "ferrari", teamName: "Scuderia Ferrari HP" },

  // McLaren
  { code: "NOR", name: "Lando Norris", teamId: "mclaren", teamName: "McLaren" },
  { code: "PIA", name: "Oscar Piastri", teamId: "mclaren", teamName: "McLaren" },

  // Mercedes
  { code: "RUS", name: "George Russell", teamId: "mercedes", teamName: "Mercedes" },
  { code: "ANT", name: "Andrea Kimi Antonelli", teamId: "mercedes", teamName: "Mercedes" },

  // Aston Martin
  { code: "ALO", name: "Fernando Alonso", teamId: "aston", teamName: "Aston Martin Aramco Formula One Team" },
  { code: "STR", name: "Lance Stroll", teamId: "aston", teamName: "Aston Martin Aramco Formula One Team" },

  // Alpine
  { code: "GAS", name: "Pierre Gasly", teamId: "alpine", teamName: "BWT Alpine Formula One Team" },
  { code: "COL", name: "Franco Colapinto", teamId: "alpine", teamName: "BWT Alpine Formula One Team" },

  // Williams
  { code: "ALB", name: "Alex Albon", teamId: "williams", teamName: "Atlassian Williams F1 Team" },
  { code: "SAI", name: "Carlos Sainz", teamId: "williams", teamName: "Atlassian Williams F1 Team" },

  // Haas
  { code: "OCO", name: "Esteban Ocon", teamId: "haas", teamName: "TGR Haas F1 Team" },
  { code: "BEA", name: "Oliver Bearman", teamId: "haas", teamName: "TGR Haas F1 Team" },

  // Racing Bulls
  { code: "LAW", name: "Liam Lawson", teamId: "racingbulls", teamName: "Visa Cash App Racing Bulls F1 Team" },
  { code: "LIN", name: "Arvid Lindblad", teamId: "racingbulls", teamName: "Visa Cash App Racing Bulls F1 Team" },

  // Audi
  { code: "HUL", name: "Nico Hulkenberg", teamId: "audi", teamName: "Audi Revolut F1 Team" },
  { code: "BOR", name: "Gabriel Bortoleto", teamId: "audi", teamName: "Audi Revolut F1 Team" },

  // Cadillac
  { code: "BOT", name: "Valtteri Bottas", teamId: "cadillac", teamName: "Cadillac" },
  { code: "PER", name: "Sergio Perez", teamId: "cadillac", teamName: "Cadillac" },
];

export function getTeamByDriverCode(code: string): F1Team | null {
  const c = (code ?? "").trim().toUpperCase();
  const d = F1_DRIVERS_2026.find((x) => x.code === c);
  if (!d) return null;
  return F1_TEAMS_2026.find((t) => t.id === d.teamId) ?? null;
}

export function getTeamColorByDriverCode(code: string): string {
  return getTeamByDriverCode(code)?.color ?? "#999999";
}

export function getDriversByTeam(): Array<{ team: F1Team; drivers: F1Driver[] }> {
  return F1_TEAMS_2026.map((team) => ({
    team,
    drivers: F1_DRIVERS_2026.filter((d) => d.teamId === team.id),
  }));
}
