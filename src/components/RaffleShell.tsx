"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Copy,
  Gift,
  KeyRound,
  Mail,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Shuffle,
  Ticket,
  TicketCheck,
  Trophy,
  UserRound,
  WalletCards
} from "lucide-react";
import { brand } from "@/lib/brand";
import { supabase } from "@/lib/supabaseClient";
import type { PixCheckout, Raffle, RaffleNumber, RaffleStatus } from "@/lib/types";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const statusLabel: Record<RaffleStatus, string> = {
  draft: "Rascunho",
  open: "Aberta",
  closed: "Fechada",
  drawn: "Sorteada"
};

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function statusClass(status: RaffleStatus) {
  if (status === "open") {
    return "green";
  }

  if (status === "drawn") {
    return "blue";
  }

  return "amber";
}

export function RaffleShell() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [activeRaffleId, setActiveRaffleId] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<RaffleNumber[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [randomQuantity, setRandomQuantity] = useState("1");
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkout, setCheckout] = useState<PixCheckout | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerWhatsapp, setBuyerWhatsapp] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  const [pixCopied, setPixCopied] = useState(false);

  const activeRaffle = useMemo(
    () => raffles.find((raffle) => raffle.id === activeRaffleId) ?? null,
    [activeRaffleId, raffles]
  );

  const activeDrawDate = formatDate(activeRaffle?.draw_at ?? null);
  const paidCount = numbers.filter((number) => number.status === "paid").length;
  const reservedCount = numbers.filter((number) => number.status === "reserved").length;
  const availableCount = numbers.filter((number) => number.status === "available").length;
  const progress = activeRaffle?.total_numbers
    ? Math.round((paidCount / activeRaffle.total_numbers) * 100)
    : 0;
  const total = activeRaffle
    ? selectedNumbers.length * Number(activeRaffle.price_per_number)
    : 0;
  const selectedText =
    selectedNumbers.length > 0
      ? selectedNumbers.join(", ")
      : "Nenhum numero selecionado.";

  useEffect(() => {
    fetchRaffles();
  }, []);

  useEffect(() => {
    if (!activeRaffleId) {
      return;
    }

    fetchNumbers(activeRaffleId);

    const channel = supabase
      .channel(`raffle_numbers:${activeRaffleId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "raffle_numbers",
          filter: `raffle_id=eq.${activeRaffleId}`
        },
        () => fetchNumbers(activeRaffleId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRaffleId]);

  async function fetchRaffles() {
    setLoading(true);
    const { data, error } = await supabase
      .from("raffles")
      .select(
        "id,title,description,prize_title,image_url,price_per_number,total_numbers,status,draw_at,winning_number,winner_order_id,drawn_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (!error && data) {
      const mapped = data as Raffle[];
      setRaffles(mapped);
      setActiveRaffleId((current) => {
        if (mapped.some((raffle) => raffle.id === current)) {
          return current;
        }

        return mapped.find((raffle) => raffle.status === "open")?.id ?? mapped[0]?.id ?? null;
      });
    }

    setLoading(false);
  }

  async function fetchNumbers(raffleId: string) {
    const { data, error } = await supabase
      .from("raffle_numbers")
      .select("id,raffle_id,number,status,reserved_until")
      .eq("raffle_id", raffleId)
      .order("number");

    if (!error && data) {
      const mapped = data as RaffleNumber[];
      setNumbers(mapped);
      return mapped;
    }

    return [];
  }

  function toggleNumber(number: RaffleNumber) {
    if (activeRaffle?.status !== "open" || number.status !== "available") {
      return;
    }

    setSelectedNumbers((current) =>
      current.includes(number.number)
        ? current.filter((item) => item !== number.number)
        : [...current, number.number].sort((a, b) => a - b)
    );
    setCheckout(null);
    setPixCopied(false);
  }

  function selectRaffle(raffleId: string) {
    setActiveRaffleId(raffleId);
    setSelectedNumbers([]);
    setCheckout(null);
    setPixCopied(false);
    setStatusMessage("");
  }

  function selectRandomNumbers() {
    const availableNumbers = numbers
      .filter((number) => number.status === "available")
      .map((number) => number.number);
    const requestedQuantity = Math.max(1, Number(randomQuantity) || 1);
    const quantity = Math.min(requestedQuantity, availableNumbers.length, 100);

    if (quantity === 0) {
      setStatusMessage("Nao ha numeros disponiveis nessa campanha.");
      return;
    }

    const shuffled = [...availableNumbers].sort(() => Math.random() - 0.5);
    const nextNumbers = shuffled.slice(0, quantity).sort((a, b) => a - b);

    setSelectedNumbers(nextNumbers);
    setCheckout(null);
    setPixCopied(false);
    setStatusMessage(
      quantity === 1
        ? `Numero aleatorio escolhido: ${nextNumbers[0]}.`
        : `${quantity} numeros aleatorios escolhidos.`
    );
  }

  async function createPixCheckout() {
    if (!activeRaffle) {
      setStatusMessage("Escolha uma campanha antes de gerar o PIX.");
      return;
    }

    if (selectedNumbers.length === 0) {
      setStatusMessage("Escolha pelo menos um numero.");
      return;
    }

    if (activeRaffle.status !== "open") {
      setStatusMessage("Essa campanha nao esta aberta para novas compras.");
      return;
    }

    if (buyerName.trim().length < 2) {
      setStatusMessage("Informe o nome do comprador.");
      return;
    }

    if (buyerWhatsapp.replace(/\D/g, "").length < 10) {
      setStatusMessage("Informe um WhatsApp valido com DDD.");
      return;
    }

    setCheckoutLoading(true);
    setPixCopied(false);
    setStatusMessage("");

    const response = await fetch("/api/checkout/pix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rifaId: activeRaffle.id,
        numerosSelecionados: selectedNumbers,
        nomeComprador: buyerName,
        whatsapp: buyerWhatsapp,
        email: buyerEmail,
        contato: buyerContact
      })
    });

    const payload = (await response.json()) as PixCheckout;
    setCheckout(payload);
    setCheckoutLoading(false);

    if (!payload.success) {
      setStatusMessage(payload.error ?? "Nao foi possivel gerar o PIX.");
      const nextNumbers = await fetchNumbers(activeRaffle.id);
      const availableNumbers = new Set(
        nextNumbers
          .filter((number) => number.status === "available")
          .map((number) => number.number)
      );
      setSelectedNumbers((current) =>
        current.filter((number) => availableNumbers.has(number))
      );
      return;
    }

    setStatusMessage("PIX gerado. Aguardando confirmacao do Mercado Pago.");
    await fetchNumbers(activeRaffle.id);
  }

  async function copyPixCode() {
    if (!checkout?.copiaECola) {
      return;
    }

    try {
      await navigator.clipboard.writeText(checkout.copiaECola);
      setPixCopied(true);
      setStatusMessage("Codigo PIX copiado.");
    } catch {
      setStatusMessage("Nao foi possivel copiar automaticamente. Selecione e copie o codigo.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <TicketCheck size={24} />
          </div>
          <div>
            <h1>{brand.name}</h1>
            <span>{brand.tagline}</span>
          </div>
        </div>

        <div className="top-actions">
          <button className="button secondary" type="button" onClick={fetchRaffles}>
            <RefreshCw size={17} />
            Atualizar
          </button>
          <Link className="button secondary" href="/admin">
            <KeyRound size={17} />
            Admin
          </Link>
        </div>
      </header>

      <section className="store-hero">
        <div className="hero-copy">
          <p className="eyebrow">Vitrine de campanhas</p>
          <h2>Campanhas com compra rapida, PIX e gestao em tempo real.</h2>
          <p>
            Escolha a campanha, marque seus numeros e gere o PIX sem sair da pagina.
          </p>
          <div className="hero-points">
            <span>
              <ShieldCheck size={16} />
              Mercado Pago
            </span>
            <span>
              <BadgeCheck size={16} />
              Reserva automatica
            </span>
            <span>
              <WalletCards size={16} />
              PIX copia e cola
            </span>
          </div>
        </div>

        <div className="hero-preview">
          <div className="hero-media">
            {activeRaffle?.image_url ? (
              <img src={activeRaffle.image_url} alt={activeRaffle.prize_title} />
            ) : (
              <div className="visual-placeholder">
                <Gift size={52} />
              </div>
            )}
          </div>
          <div className="hero-preview-content">
            <span className={`pill ${activeRaffle ? statusClass(activeRaffle.status) : "blue"}`}>
              {activeRaffle ? statusLabel[activeRaffle.status] : "Campanha"}
            </span>
            <h3>{activeRaffle?.prize_title ?? "Sua proxima campanha"}</h3>
            {activeDrawDate ? (
              <span className="hero-date">
                <CalendarDays size={15} />
                Sorteio em {activeDrawDate}
              </span>
            ) : null}
            <div className="hero-price">
              <span>Cota</span>
              <strong>
                {activeRaffle
                  ? currency.format(Number(activeRaffle.price_per_number))
                  : currency.format(0)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <div className="layout-grid">
        <div className="content-stack">
          <section className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Campanhas disponiveis</p>
                <h2>Escolha uma campanha</h2>
              </div>
              <span className="pill green">
                <Ticket size={15} />
                PIX integrado
              </span>
            </div>

            {loading ? (
              <p className="muted">Carregando campanhas...</p>
            ) : raffles.length === 0 ? (
              <div className="empty-state">
                <Gift size={30} />
                <div>
                  <strong>Nenhuma campanha publicada.</strong>
                  <p className="muted">Crie a primeira campanha no painel admin.</p>
                </div>
              </div>
            ) : (
              <div className="raffle-list">
                {raffles.map((raffle) => {
                  const drawDate = formatDate(raffle.draw_at);

                  return (
                    <button
                      className={`raffle-card ${
                        raffle.id === activeRaffleId ? "active" : ""
                      }`}
                      key={raffle.id}
                      type="button"
                      onClick={() => selectRaffle(raffle.id)}
                    >
                      <div className="raffle-media">
                        {raffle.image_url ? (
                          <img src={raffle.image_url} alt={raffle.prize_title} />
                        ) : (
                          <div className="raffle-placeholder">
                            <Ticket size={34} />
                          </div>
                        )}
                      </div>
                      <div className="raffle-card-body">
                        <span className={`pill ${statusClass(raffle.status)}`}>
                          {statusLabel[raffle.status]}
                        </span>
                        <h3>{raffle.title}</h3>
                        <p>{raffle.prize_title}</p>
                      </div>
                      <div className="meta-row">
                        <span className="pill green">
                          {currency.format(Number(raffle.price_per_number))}
                        </span>
                        <span className="pill">{raffle.total_numbers} numeros</span>
                        {raffle.status === "drawn" && raffle.winning_number ? (
                          <span className="pill blue">Sorteado: {raffle.winning_number}</span>
                        ) : null}
                        {drawDate ? (
                          <span className="pill">
                            <CalendarDays size={14} />
                            {drawDate}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {activeRaffle ? (
            <section className="panel raffle-detail">
              <div className="section-title">
                <div>
                  <p className="eyebrow">{activeRaffle.title}</p>
                  <h2>{activeRaffle.description ?? activeRaffle.prize_title}</h2>
                </div>
                <span className={`pill ${statusClass(activeRaffle.status)}`}>
                  {statusLabel[activeRaffle.status]}
                </span>
              </div>

              {activeRaffle.status === "drawn" && activeRaffle.winning_number ? (
                <div className="message winner-message">
                  <Trophy size={18} />
                  Numero sorteado: <strong>{activeRaffle.winning_number}</strong>
                </div>
              ) : null}

              <div className="stat-grid">
                <div className="stat-card">
                  <span>Vendidos</span>
                  <strong>{paidCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Reservados</span>
                  <strong>{reservedCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Disponiveis</span>
                  <strong>{availableCount}</strong>
                </div>
                <div className="stat-card">
                  <span>Progresso</span>
                  <strong>{progress}%</strong>
                </div>
              </div>

              <div className="progress-track" aria-label={`${progress}% das cotas vendidas`}>
                <span style={{ width: `${progress}%` }} />
              </div>

              <div className="detail-toolbar">
                <div className="legend">
                  <span>
                    <i className="status-dot available" />
                    Livre
                  </span>
                  <span>
                    <i className="status-dot reserved" />
                    Reservado
                  </span>
                  <span>
                    <i className="status-dot paid" />
                    Pago
                  </span>
                </div>

                {activeRaffle.status === "open" ? (
                  <div className="random-picker">
                    <div className="field compact">
                      <label htmlFor="random-quantity">Aleatorios</label>
                      <input
                        id="random-quantity"
                        max="100"
                        min="1"
                        onChange={(event) => setRandomQuantity(event.target.value)}
                        type="number"
                        value={randomQuantity}
                      />
                    </div>
                    <button className="button secondary" type="button" onClick={selectRandomNumbers}>
                      <Shuffle size={17} />
                      Gerar
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="number-grid">
                {numbers.map((number) => {
                  const isSelected = selectedNumbers.includes(number.number);

                  return (
                    <button
                      className={`number-button ${number.status} ${
                        isSelected ? "selected" : ""
                      }`}
                      disabled={activeRaffle.status !== "open" || number.status !== "available"}
                      key={number.id}
                      type="button"
                      onClick={() => toggleNumber(number)}
                      title={`Numero ${number.number}: ${number.status}`}
                    >
                      {number.number}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="sidebar">
          <section className="auth-panel checkout">
            <div className="checkout-head">
              <div>
                <p className="eyebrow">Checkout PIX</p>
                <h3>Resumo da compra</h3>
              </div>
              <QrCode size={24} />
            </div>

            <div className="selected-box">
              <span>Numeros escolhidos</span>
              <strong>{selectedNumbers.length}</strong>
              <p>{selectedText}</p>
            </div>

            <div className="summary-row">
              <span>Total</span>
              <strong className="total">{currency.format(total)}</strong>
            </div>

            <div className="field">
              <label htmlFor="buyer-name">Nome do comprador</label>
              <div className="input-with-icon">
                <UserRound size={17} />
                <input
                  id="buyer-name"
                  onChange={(event) => setBuyerName(event.target.value)}
                  placeholder="Nome completo"
                  value={buyerName}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="buyer-whatsapp">WhatsApp</label>
              <div className="input-with-icon">
                <Phone size={17} />
                <input
                  id="buyer-whatsapp"
                  inputMode="tel"
                  onChange={(event) => setBuyerWhatsapp(event.target.value)}
                  placeholder="85999999999"
                  type="tel"
                  value={buyerWhatsapp}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="buyer-email">E-mail ou contato extra</label>
              <div className="input-with-icon">
                <Mail size={17} />
                <input
                  id="buyer-email"
                  onChange={(event) => {
                    setBuyerEmail(event.target.value);
                    setBuyerContact(event.target.value);
                  }}
                  placeholder="contato@email.com"
                  type="email"
                  value={buyerEmail}
                />
              </div>
            </div>

            <button
              className="button"
              disabled={checkoutLoading || activeRaffle?.status !== "open"}
              type="button"
              onClick={createPixCheckout}
            >
              <QrCode size={18} />
              {checkoutLoading ? "Gerando PIX..." : "Gerar PIX"}
            </button>

            <div className="checkout-foot">
              <ShieldCheck size={16} />
              Processamento via Mercado Pago. A confirmacao atualiza os numeros
              automaticamente.
            </div>

            {statusMessage ? (
              <div
                className={`message ${checkout?.success === false ? "error" : ""}`}
                aria-live="polite"
              >
                {statusMessage}
              </div>
            ) : null}

            {checkout?.success ? (
              <div className="qr-box">
                {checkout.qrCodeBase64 ? (
                  <img
                    alt="QR Code PIX"
                    src={`data:image/png;base64,${checkout.qrCodeBase64}`}
                  />
                ) : null}
                {checkout.copiaECola ? (
                  <>
                    <div className="copy-area">{checkout.copiaECola}</div>
                    <button className="button secondary" type="button" onClick={copyPixCode}>
                      {pixCopied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                      {pixCopied ? "Codigo copiado" : "Copiar codigo PIX"}
                    </button>
                  </>
                ) : null}
                <span className="pill green">
                  <CheckCircle2 size={15} />
                  Pedido criado
                </span>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
