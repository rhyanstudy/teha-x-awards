export const EDITION = "2026";

export const ACTS = [
  {
    id: "secundarias",
    numeral: "I",
    kicker: "Ato I",
    title: "Secundárias",
    categories: [
      { id: "coadjuvante", title: "Coadjuvante do Ano", nominees: ["Jonas", "Otávio", "Rhyan"] },
      { id: "buticador", title: "Buticador do Ano", nominees: ["Rhyan", "Mauricio", "Pedro"] },
      { id: "pior-ser-humano", title: "Pior ser humano do Ano", nominees: ["Gaspar", "Nico", "Pedro", "Rhyan"] },
      { id: "monark", title: "Monark do Ano", nominees: ["Mauricio", "Nicomedes", "Gaspar"] },
      { id: "acorda-cara", title: "ACORDA CARA do Ano", nominees: ["Caio", "Rez", "Nicomedes"] },
      { id: "robb-stark", title: "Robb Stark da Paz", nominees: ["Pedro", "Nicomedes", "Mauricio"] },
      { id: "performatico", title: "Performático do Ano", nominees: ["Jonas", "Nicomedes", "Pedro"] },
      { id: "ryan", title: "Ryan do Ano", nominees: ["Rhyan", "Nestor", "Pedro"] },
      { id: "alma-preta", title: "Alma preta do Ano", nominees: ["Pedro", "Otávio", "Rhyan"] },
      { id: "tadinho", title: "Tadinho da Silva do Ano", nominees: ["Mauricio", "Otávio"] },
      { id: "churrasqueiro", title: "Churrasqueiro do Ano", nominees: ["Otávio", "Pedro", "Nicomedes"] },
      { id: "dj", title: "DJ do Ano", nominees: ["Pedro", "Otávio", "Nicomedes"] },
      { id: "otavio", title: "Otávio do Ano", nominees: ["Otávio", "Mauricio", "Rhyan"] },
    ],
  },
  {
    id: "principais",
    numeral: "II",
    kicker: "Ato II",
    title: "Principais",
    categories: [
      { id: "carlinhos", title: "Prêmio Carlinhos", featured: true, nominees: ["Pedro", "Rhyan", "Nicomedes"] },
      { id: "revelacao", title: "Revelação do Ano", nominees: ["Nestor", "Mauricio", "Otávio"] },
      { id: "melhor-jogador", title: "Melhor Jogador do Ano", nominees: ["Rhyan", "Nestor", "Pedro"] },
      { id: "pior-jogador", title: "Pior Jogador do Ano", nominees: ["Otávio", "Wallace", "Jonas"] },
      { id: "massa", title: "Massa de Manobra do Ano", nominees: ["Nicomedes", "Mauricio", "Jonas"] },
      { id: "craque", title: "Craque da Galera", nominees: ["Pedro", "Rhyan", "Caio"] },
      { id: "edilson", title: "Edilson do Ano", nominees: ["Pedro", "Rez", "Rhyan"] },
    ],
  },
];

export function allCategories() {
  return ACTS.flatMap((act) =>
    act.categories.map((category) => ({
      ...category,
      actId: act.id,
      actTitle: act.title,
    })),
  );
}

export function categoryById(id) {
  return allCategories().find((category) => category.id === id) || null;
}
