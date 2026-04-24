import { useState, useEffect } from "react";
import { Lightbulb, RefreshCw } from "lucide-react";

const CURIOSITIES = [
  { fruit: "Maçã", fact: "A maçã contém antioxidantes naturais chamados polifenóis, que ajudam a proteger o coração e reduzir o colesterol." },
  { fruit: "Banana", fact: "A banana é uma das frutas mais ricas em potássio, mineral essencial para a saúde muscular e o bom funcionamento do coração." },
  { fruit: "Laranja", fact: "Uma laranja média fornece mais de 100% da dose diária recomendada de vitamina C, fortalecendo o sistema imunológico." },
  { fruit: "Morango", fact: "O morango tem mais vitamina C por porção do que a laranja! Além disso, é rico em manganês e antioxidantes." },
  { fruit: "Manga", fact: "A manga é rica em vitamina A, essencial para a saúde dos olhos e da pele. É também uma ótima fonte de vitamina C e fibras." },
  { fruit: "Uva", fact: "As uvas roxas contêm resveratrol, um poderoso antioxidante associado à saúde cardiovascular e à longevidade." },
  { fruit: "Abacaxi", fact: "O abacaxi contém bromelina, uma enzima que auxilia na digestão de proteínas e tem propriedades anti-inflamatórias." },
  { fruit: "Melancia", fact: "A melancia é composta por cerca de 92% de água, sendo excelente para a hidratação. Também é rica em licopeno, que protege contra doenças." },
  { fruit: "Mamão", fact: "O mamão contém papaína, enzima que ajuda na digestão. Rico em vitamina C e betacaroteno, favorece a imunidade e a saúde da pele." },
  { fruit: "Pêssego", fact: "O pêssego é rico em vitaminas A e C, além de potássio. Seu baixo teor calórico faz dele uma ótima opção para dietas saudáveis." },
  { fruit: "Kiwi", fact: "O kiwi tem mais vitamina C do que a laranja! Também é rico em vitamina K, essencial para a coagulação sanguínea e a saúde óssea." },
  { fruit: "Pera", fact: "A pera é uma das frutas mais ricas em fibras solúveis, que ajudam a regular o intestino e reduzir o colesterol no sangue." },
  { fruit: "Cereja", fact: "As cerejas contêm melatonina natural, hormônio que regula o sono. Consumi-las pode ajudar a melhorar a qualidade do descanso noturno." },
  { fruit: "Limão", fact: "O limão é um poderoso alcalinizante do organismo, mesmo sendo ácido. Ajuda na desintoxicação do fígado e fortalece as defesas do corpo." },
  { fruit: "Abacate", fact: "O abacate é rico em gorduras monoinsaturadas saudáveis, que ajudam a reduzir o colesterol ruim (LDL) e aumentar o bom (HDL)." },
  { fruit: "Coco", fact: "A água de coco é um isotônico natural, repleta de eletrólitos como potássio, sódio e magnésio, ideal para reposição após exercícios." },
  { fruit: "Ameixa", fact: "As ameixas são ricas em sorbitol e fibras, sendo eficazes para combater a prisão de ventre de forma natural e saudável." },
  { fruit: "Goiaba", fact: "A goiaba tem uma das maiores concentrações de vitamina C entre as frutas — uma unidade pode fornecer até 4 vezes a dose diária recomendada." },
  { fruit: "Açaí", fact: "O açaí é considerado um superalimento: rico em antioxidantes, gorduras saudáveis e fibras. Auxilia no combate ao envelhecimento celular." },
  { fruit: "Caju", fact: "O caju (parte carnosa) tem 5 vezes mais vitamina C do que a laranja. A castanha de caju é fonte de zinco, magnésio e gorduras saudáveis." },
  { fruit: "Tangerina", fact: "A tangerina é rica em flavonoides, compostos que ajudam a reduzir inflamações e proteger o sistema cardiovascular." },
  { fruit: "Framboesa", fact: "As framboesas têm um dos maiores teores de fibras entre as frutas — apenas 100g fornecem cerca de 7g de fibras alimentares." },
  { fruit: "Melão", fact: "O melão é fonte de betacaroteno e vitamina C. Seu alto teor de água (90%) o torna excelente para hidratação nos dias quentes." },
  { fruit: "Figo", fact: "O figo é rico em cálcio, potássio e magnésio. Consumido seco, concentra ainda mais os nutrientes e é ótimo para a saúde óssea." },
  { fruit: "Pitaya", fact: "A pitaya (fruta do dragão) é rica em antioxidantes, vitamina C e fibras prebióticas que alimentam as bactérias benéficas do intestino." },
];

interface FruitCuriositiesProps {
  className?: string;
  compact?: boolean;
}

export function FruitCuriosities({ className = "", compact = false }: FruitCuriositiesProps) {
  const [current, setCurrent] = useState(() => Math.floor(Math.random() * CURIOSITIES.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent(prev => {
        let next = Math.floor(Math.random() * CURIOSITIES.length);
        while (next === prev) next = Math.floor(Math.random() * CURIOSITIES.length);
        return next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const { fruit, fact } = CURIOSITIES[current];

  if (compact) {
    return (
      <div className={`flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl ${className}`} data-testid="fruit-curiosity-compact">
        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Lightbulb className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-700 mb-0.5">🍊 Você sabia? — {fruit}</p>
          <p className="text-xs text-amber-800 leading-relaxed">{fact}</p>
        </div>
        <button
          onClick={() => {
            let next = Math.floor(Math.random() * CURIOSITIES.length);
            while (next === current) next = Math.floor(Math.random() * CURIOSITIES.length);
            setCurrent(next);
          }}
          data-testid="button-curiosity-refresh"
          className="text-amber-500 hover:text-amber-700 transition-colors flex-shrink-0 mt-0.5"
          title="Ver outra curiosidade"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 ${className}`} data-testid="fruit-curiosity-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Curiosidades do Dia</p>
            <p className="text-xs text-amber-600">Conteúdo educativo VivaFrutaz</p>
          </div>
        </div>
        <button
          onClick={() => {
            let next = Math.floor(Math.random() * CURIOSITIES.length);
            while (next === current) next = Math.floor(Math.random() * CURIOSITIES.length);
            setCurrent(next);
          }}
          data-testid="button-curiosity-next"
          className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors px-2.5 py-1.5 rounded-lg hover:bg-amber-100"
          title="Ver outra curiosidade"
        >
          <RefreshCw className="w-3 h-3" /> Outra
        </button>
      </div>
      <div className="bg-white/70 rounded-xl p-4 border border-amber-100">
        <p className="text-sm font-bold text-orange-700 mb-1.5">🍊 {fruit}</p>
        <p className="text-sm text-foreground/80 leading-relaxed">
          <span className="font-semibold text-amber-700">Você sabia? </span>
          {fact}
        </p>
      </div>
      <div className="flex gap-1.5 mt-3 flex-wrap">
        {CURIOSITIES.slice(0, 5).map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            data-testid={`button-curiosity-dot-${i}`}
            className={`w-2 h-2 rounded-full transition-all ${i === current % 5 ? 'bg-amber-500 w-4' : 'bg-amber-200 hover:bg-amber-300'}`}
          />
        ))}
      </div>
    </div>
  );
}
