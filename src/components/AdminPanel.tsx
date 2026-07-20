"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Home,
  ImageUp,
  KeyRound,
  Lock,
  LogOut,
  MessageCircle,
  Phone,
  PlusCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  Trophy,
  Trash2
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { brand } from "@/lib/brand";
import { supabase } from "@/lib/supabaseClient";
import type { DrawResult, PaidRaffleNumber, Raffle } from "@/lib/types";

type AdminForm = {
  title: string;
  prizeTitle: string;
  description: string;
  imageUrl: string;
  pricePerNumber: string;
  totalNumbers: string;
  drawAt: string;
  status: "draft" | "open";
};

const maxUploadImageSize = 5 * 1024 * 1024;
const imageCompressThreshold = 1.2 * 1024 * 1024;
const imageMaxSide = 1600;

const initialForm: AdminForm = {
  title: `${brand.name} - Campanha principal`,
  prizeTitle: "",
  description: "",
  imageUrl: "",
  pricePerNumber: "10",
  totalNumbers: "100",
  drawAt: "",
  status: "open"
};

type DrawModalState = {
  raffleTitle: string;
  phase: "rolling" | "winner" | "error";
  displayNumber: number | null;
  candidateNumbers: number[];
  result?: DrawResult;
  error?: string;
};

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameWithoutExtension(name: string) {
  return name.replace(/\.[^/.]+$/, "") || "campanha";
}

function toDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function dateTimeInputToIso(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function imageToWebp(file: File) {
  if (file.size < imageCompressThreshold || file.type === "image/gif") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, imageMaxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.84);
  });

  if (!blob || blob.size >= file.size) {
    return file;
  }

  return new File([blob], `${fileNameWithoutExtension(file.name)}.webp`, {
    type: "image/webp",
    lastModified: Date.now()
  });
}

function whatsappHref(value: string | null) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 10) {
    return null;
  }

  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}

export function AdminPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [form, setForm] = useState<AdminForm>(initialForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [loadingRaffles, setLoadingRaffles] = useState(false);
  const [deletingRaffleId, setDeletingRaffleId] = useState<string | null>(null);
  const [expandedRaffleId, setExpandedRaffleId] = useState<string | null>(null);
  const [loadingNumbersId, setLoadingNumbersId] = useState<string | null>(null);
  const [drawingRaffleId, setDrawingRaffleId] = useState<string | null>(null);
  const [savingDrawDateId, setSavingDrawDateId] = useState<string | null>(null);
  const [drawDateEdits, setDrawDateEdits] = useState<Record<string, string>>({});
  const [paidNumbersByRaffle, setPaidNumbersByRaffle] = useState<
    Record<string, PaidRaffleNumber[]>
  >({});
  const [drawResults, setDrawResults] = useState<Record<string, DrawResult>>({});
  const [drawModal, setDrawModal] = useState<DrawModalState | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setEmail(data.session?.user.email ?? "");
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setEmail(nextSession?.user.email ?? "");
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      setCheckingAdmin(true);

      if (!session) {
        setIsAdmin(false);
        setCheckingAdmin(false);
        return;
      }

      const { data, error: adminError } = await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!cancelled) {
        setIsAdmin(Boolean(data && !adminError));
        setCheckingAdmin(false);
      }
    }

    checkAdmin();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (isAdmin) {
      fetchAdminRaffles();
    }
  }, [isAdmin]);

  async function fetchAdminRaffles() {
    setLoadingRaffles(true);
    const { data, error: rafflesError } = await supabase
      .from("raffles")
      .select(
        "id,title,description,prize_title,image_url,price_per_number,total_numbers,status,draw_at,winning_number,winner_order_id,drawn_at,created_at"
      )
      .order("created_at", { ascending: false });

    setLoadingRaffles(false);

    if (rafflesError) {
      setError(rafflesError.message);
      return;
    }

    const nextRaffles = (data ?? []) as Raffle[];
    setRaffles(nextRaffles);
    setDrawDateEdits(
      Object.fromEntries(
        nextRaffles.map((raffle) => [raffle.id, toDateTimeInputValue(raffle.draw_at)])
      )
    );
  }

  async function fetchPaidNumbers(raffle: Raffle) {
    if (!session) {
      setError("Entre antes de consultar compradores.");
      return;
    }

    setError("");
    setExpandedRaffleId(raffle.id);
    setLoadingNumbersId(raffle.id);

    const response = await fetch(`/api/admin/raffles/${raffle.id}/numbers`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    const payload = (await response.json()) as {
      error?: string;
      numbers?: PaidRaffleNumber[];
    };
    setLoadingNumbersId(null);

    if (!response.ok) {
      setError(payload.error ?? "Nao foi possivel carregar compradores.");
      return;
    }

    setPaidNumbersByRaffle((current) => ({
      ...current,
      [raffle.id]: payload.numbers ?? []
    }));
  }

  async function drawRaffle(raffle: Raffle) {
    if (!session) {
      setError("Entre antes de sortear uma campanha.");
      return;
    }

    setError("");
    setMessage("");
    setDrawingRaffleId(raffle.id);
    setExpandedRaffleId(raffle.id);

    let animationTimer: number | null = null;

    try {
      const numbersResponse = await fetch(`/api/admin/raffles/${raffle.id}/numbers`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const numbersPayload = (await numbersResponse.json()) as {
        error?: string;
        numbers?: PaidRaffleNumber[];
      };

      if (!numbersResponse.ok) {
        throw new Error(numbersPayload.error ?? "Nao foi possivel carregar compradores.");
      }

      const paidNumbers = numbersPayload.numbers ?? [];
      const candidateNumbers = paidNumbers.map((item) => item.number);

      setPaidNumbersByRaffle((current) => ({
        ...current,
        [raffle.id]: paidNumbers
      }));

      if (candidateNumbers.length === 0) {
        const emptyMessage = "Ainda nao ha numeros pagos para sortear.";
        setError(emptyMessage);
        setDrawModal({
          raffleTitle: raffle.title,
          phase: "error",
          displayNumber: null,
          candidateNumbers,
          error: emptyMessage
        });
        return;
      }

      const firstDisplay =
        candidateNumbers[Math.floor(Math.random() * candidateNumbers.length)];

      setDrawModal({
        raffleTitle: raffle.title,
        phase: "rolling",
        displayNumber: firstDisplay,
        candidateNumbers
      });

      animationTimer = window.setInterval(() => {
        const nextDisplay =
          candidateNumbers[Math.floor(Math.random() * candidateNumbers.length)];

        setDrawModal((current) => {
          if (!current || current.phase !== "rolling") {
            return current;
          }

          return {
            ...current,
            displayNumber: nextDisplay
          };
        });
      }, 85);

      await wait(2600);

      const response = await fetch(`/api/admin/raffles/${raffle.id}/draw`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      const payload = (await response.json()) as DrawResult & { error?: string };

      if (animationTimer) {
        window.clearInterval(animationTimer);
        animationTimer = null;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel realizar o sorteio.");
      }

      setDrawResults((current) => ({
        ...current,
        [raffle.id]: payload
      }));
      setDrawModal({
        raffleTitle: raffle.title,
        phase: "winner",
        displayNumber: payload.winningNumber,
        candidateNumbers,
        result: payload
      });
      setMessage(
        payload.alreadyDrawn
          ? `Essa campanha ja estava sorteada. Numero vencedor: ${payload.winningNumber}.`
          : `Sorteio realizado. Numero vencedor: ${payload.winningNumber}.`
      );
      await fetchAdminRaffles();
    } catch (drawError) {
      const drawMessage =
        drawError instanceof Error ? drawError.message : "Nao foi possivel realizar o sorteio.";

      setError(drawMessage);
      setDrawModal({
        raffleTitle: raffle.title,
        phase: "error",
        displayNumber: null,
        candidateNumbers: [],
        error: drawMessage
      });
    } finally {
      if (animationTimer) {
        window.clearInterval(animationTimer);
      }

      setDrawingRaffleId(null);
    }
  }

  async function saveRaffleDrawDate(raffle: Raffle) {
    if (!session) {
      setError("Entre antes de editar a data do sorteio.");
      return;
    }

    const nextDrawAt = dateTimeInputToIso(drawDateEdits[raffle.id] ?? "");

    if (!nextDrawAt) {
      setError("Informe uma data valida para o sorteio.");
      return;
    }

    setError("");
    setMessage("");
    setSavingDrawDateId(raffle.id);

    const response = await fetch("/api/admin/raffles", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        id: raffle.id,
        drawAt: nextDrawAt
      })
    });

    const payload = (await response.json()) as { error?: string; success?: boolean };
    setSavingDrawDateId(null);

    if (!response.ok || !payload.success) {
      setError(payload.error ?? "Nao foi possivel alterar a data do sorteio.");
      return;
    }

    setMessage("Data do sorteio atualizada.");
    await fetchAdminRaffles();
  }

  async function sendMagicLink() {
    setError("");
    setMessage("");

    if (!email) {
      setError("Informe seu e-mail de administrador.");
      return;
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/admin`
      }
    });

    if (authError) {
      setError(authError.message);
      return;
    }

    setMessage("Link de acesso enviado para o e-mail informado.");
  }

  async function signInWithPassword() {
    setError("");
    setMessage("");

    if (!email || !password) {
      setError("Informe e-mail e senha.");
      return;
    }

    setAuthLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    setAuthLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    setPassword("");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setRaffles([]);
  }

  async function submitRaffle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    if (!session) {
      setError("Entre antes de criar uma campanha.");
      setSubmitting(false);
      return;
    }

    let imageUrl = form.imageUrl.trim();

    if (imageFile) {
      const imageFormData = new FormData();
      imageFormData.append("file", imageFile);

      const uploadResponse = await fetch("/api/admin/uploads/raffle-image", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        body: imageFormData
      });

      const uploadPayload = (await uploadResponse.json()) as {
        error?: string;
        publicUrl?: string;
      };

      if (!uploadResponse.ok || !uploadPayload.publicUrl) {
        setError(uploadPayload.error ?? "Nao foi possivel enviar a imagem.");
        setSubmitting(false);
        return;
      }

      imageUrl = uploadPayload.publicUrl;
    }

    const response = await fetch("/api/admin/raffles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        title: form.title,
        prizeTitle: form.prizeTitle,
        description: form.description,
        imageUrl,
        pricePerNumber: Number(form.pricePerNumber),
        totalNumbers: Number(form.totalNumbers),
        drawAt: form.drawAt ? dateTimeInputToIso(form.drawAt) : null,
        status: form.status
      })
    });

    const payload = (await response.json()) as { error?: string; id?: string };
    setSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Nao foi possivel criar a campanha.");
      return;
    }

    setMessage(`Campanha criada com sucesso: ${payload.id}`);
    setForm(initialForm);
    setImageFile(null);
    await fetchAdminRaffles();
  }

  async function deleteRaffle(raffle: Raffle) {
    if (!session) {
      setError("Entre antes de excluir uma campanha.");
      return;
    }

    const confirmed = window.confirm(
      `Excluir a campanha "${raffle.title}"? Essa acao remove os numeros e pedidos ligados a ela.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");
    setDeletingRaffleId(raffle.id);

    const response = await fetch("/api/admin/raffles", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ id: raffle.id })
    });

    const payload = (await response.json()) as { error?: string; success?: boolean };
    setDeletingRaffleId(null);

    if (!response.ok) {
      setError(payload.error ?? "Nao foi possivel excluir a campanha.");
      return;
    }

    setMessage("Campanha excluida com sucesso.");
    await fetchAdminRaffles();
  }

  function updateField<Key extends keyof AdminForm>(key: Key, value: AdminForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function updateImageFile(file: File | null) {
    setError("");
    setMessage("");

    if (!file) {
      setImageFile(null);
      setImagePreview("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setImageFile(null);
      setImagePreview("");
      setError("O arquivo precisa ser uma imagem.");
      return;
    }

    let preparedFile = file;

    try {
      preparedFile = await imageToWebp(file);
    } catch {
      preparedFile = file;
    }

    if (preparedFile.size > maxUploadImageSize) {
      setImageFile(null);
      setImagePreview("");
      setError(
        `A imagem esta muito pesada (${formatFileSize(
          preparedFile.size
        )}). Use uma imagem com ate 5 MB.`
      );
      return;
    }

    setImageFile(preparedFile);
    updateField("imageUrl", "");

    if (preparedFile.size < file.size) {
      setMessage(
        `Imagem otimizada de ${formatFileSize(file.size)} para ${formatFileSize(
          preparedFile.size
        )}.`
      );
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(String(reader.result ?? ""));
    };
    reader.readAsDataURL(preparedFile);
  }

  const drawModalWhatsappLink = whatsappHref(drawModal?.result?.buyerWhatsapp ?? null);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <TicketCheck size={24} />
          </div>
          <div>
            <h1>Admin {brand.name}</h1>
            <span>{brand.adminSubtitle}</span>
          </div>
        </div>

        <div className="top-actions">
          <Link className="button secondary" href="/">
            <Home size={17} />
            Vitrine
          </Link>
          {session ? (
            <button className="button secondary" type="button" onClick={signOut}>
              <LogOut size={17} />
              Sair
            </button>
          ) : null}
        </div>
      </header>

      <div className="admin-layout">
        <section className="auth-panel">
          <h2>Acesso admin</h2>
          {session ? (
            <>
              <p className="muted">{session.user.email}</p>
              <span className={`pill ${isAdmin ? "green" : "red"}`}>
                <ShieldCheck size={15} />
                {checkingAdmin
                  ? "Verificando"
                  : isAdmin
                    ? "Administrador"
                    : "Sem permissao"}
              </span>
              {!isAdmin && !checkingAdmin ? (
                <p className="muted">
                  Adicione este usuario na tabela <strong>public.admins</strong> para
                  liberar criacao de campanhas.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="admin-email">E-mail admin</label>
                <input
                  id="admin-email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@email.com"
                  type="email"
                  value={email}
                />
              </div>
              <div className="field">
                <label htmlFor="admin-password">Senha</label>
                <input
                  id="admin-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Senha do admin"
                  type="password"
                  value={password}
                />
              </div>
              <button
                className="button"
                disabled={authLoading}
                type="button"
                onClick={signInWithPassword}
              >
                <Lock size={17} />
                Entrar com senha
              </button>
              <button
                className="button secondary"
                disabled={authLoading}
                type="button"
                onClick={sendMagicLink}
              >
                <KeyRound size={17} />
                Enviar link
              </button>
            </>
          )}
          {message ? <div className="message">{message}</div> : null}
          {error ? <div className="message error">{error}</div> : null}
        </section>

        <div className="admin-stack">
          <section className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Nova campanha</p>
                <h2>Publique campanhas com controle de venda e sorteio</h2>
              </div>
              <span className="pill green">
                <PlusCircle size={15} />
                Acesso restrito
              </span>
            </div>

            <form className="admin-form" onSubmit={submitRaffle}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="title">Nome da campanha</label>
                  <input
                    id="title"
                    onChange={(event) => updateField("title", event.target.value)}
                    required
                    value={form.title}
                  />
                </div>

                <div className="field">
                  <label htmlFor="prize">Premio principal</label>
                  <input
                    id="prize"
                    onChange={(event) => updateField("prizeTitle", event.target.value)}
                    placeholder="Ex: Combo churrasco + cerveja"
                    required
                    value={form.prizeTitle}
                  />
                </div>

                <div className="field full">
                  <label htmlFor="description">Descricao</label>
                  <textarea
                    id="description"
                    onChange={(event) => updateField("description", event.target.value)}
                    placeholder="Detalhes da campanha, retirada do premio e regras."
                    value={form.description}
                  />
                </div>

                <div className="field full">
                  <label htmlFor="imageUrl">Imagem da campanha</label>
                  <div className="image-upload-grid">
                    <label className="image-upload-drop" htmlFor="imageFile">
                      <ImageUp size={22} />
                      <span>Enviar imagem</span>
                      <input
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        id="imageFile"
                        onChange={(event) => updateImageFile(event.target.files?.[0] ?? null)}
                        type="file"
                      />
                    </label>
                    <input
                      id="imageUrl"
                      onChange={(event) => {
                        updateField("imageUrl", event.target.value);
                        setImageFile(null);
                        setImagePreview("");
                      }}
                      placeholder="ou cole uma URL https://..."
                      type="url"
                      value={form.imageUrl}
                    />
                  </div>
                  {imagePreview || form.imageUrl ? (
                    <div className="image-preview">
                      <img alt="Previa da imagem da campanha" src={imagePreview || form.imageUrl} />
                    </div>
                  ) : null}
                  {imageFile ? (
                    <p className="muted">Imagem pronta para envio: {formatFileSize(imageFile.size)}</p>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="price">Valor por numero</label>
                  <input
                    id="price"
                    min="1"
                    onChange={(event) => updateField("pricePerNumber", event.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={form.pricePerNumber}
                  />
                </div>

                <div className="field">
                  <label htmlFor="totalNumbers">Quantidade de numeros</label>
                  <input
                    id="totalNumbers"
                    max="10000"
                    min="10"
                    onChange={(event) => updateField("totalNumbers", event.target.value)}
                    required
                    type="number"
                    value={form.totalNumbers}
                  />
                </div>

                <div className="field">
                  <label htmlFor="drawAt">Data do sorteio</label>
                  <input
                    id="drawAt"
                    onChange={(event) => updateField("drawAt", event.target.value)}
                    type="datetime-local"
                    value={form.drawAt}
                  />
                </div>

                <div className="field">
                  <label htmlFor="status">Status</label>
                  <select
                    id="status"
                    onChange={(event) =>
                      updateField("status", event.target.value as AdminForm["status"])
                    }
                    value={form.status}
                  >
                    <option value="open">Aberta</option>
                    <option value="draft">Rascunho</option>
                  </select>
                </div>
              </div>

              <button className="button" disabled={!isAdmin || submitting} type="submit">
                <PlusCircle size={18} />
                {submitting ? "Salvando..." : "Criar campanha"}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Campanhas criadas</p>
                <h2>Operacao e sorteio</h2>
              </div>
              <button
                className="button secondary"
                disabled={!isAdmin || loadingRaffles}
                type="button"
                onClick={fetchAdminRaffles}
              >
                <RefreshCw size={17} />
                Atualizar
              </button>
            </div>

            {loadingRaffles ? <p className="muted">Carregando campanhas...</p> : null}
            {!loadingRaffles && raffles.length === 0 ? (
              <p className="muted">Nenhuma campanha criada ainda.</p>
            ) : null}

            <div className="admin-raffle-list">
              {raffles.map((raffle) => {
                const paidNumbers = paidNumbersByRaffle[raffle.id] ?? [];
                const drawResult = drawResults[raffle.id];
                const winnerWhatsappLink = whatsappHref(drawResult?.buyerWhatsapp ?? null);

                return (
                  <div className="admin-raffle-card" key={raffle.id}>
                    <div className="admin-raffle-row">
                      <div>
                        <strong>{raffle.title}</strong>
                        <p className="muted">
                          {raffle.prize_title} - {raffle.total_numbers} numeros -{" "}
                          {raffle.status}
                        </p>
                        {raffle.status === "drawn" && raffle.winning_number ? (
                          <span className="pill green">
                            <Trophy size={15} />
                            Sorteado: {raffle.winning_number}
                          </span>
                        ) : null}
                      </div>
                      <div className="admin-actions">
                        <button
                          className="button secondary"
                          disabled={loadingNumbersId === raffle.id}
                          type="button"
                          onClick={() => fetchPaidNumbers(raffle)}
                        >
                          <MessageCircle size={17} />
                          Compradores
                        </button>
                        <button
                          className="button"
                          disabled={drawingRaffleId === raffle.id}
                          type="button"
                          onClick={() => drawRaffle(raffle)}
                        >
                          <Trophy size={17} />
                          {drawingRaffleId === raffle.id ? "Sorteando..." : "Sortear"}
                        </button>
                        <button
                          className="button danger"
                          disabled={deletingRaffleId === raffle.id}
                          type="button"
                          onClick={() => deleteRaffle(raffle)}
                        >
                          <Trash2 size={17} />
                          Excluir
                        </button>
                      </div>
                    </div>

                    <div className="raffle-date-editor">
                      <div className="field compact">
                        <label htmlFor={`draw-date-${raffle.id}`}>Data do sorteio</label>
                        <div className="input-with-icon">
                          <CalendarDays size={17} />
                          <input
                            id={`draw-date-${raffle.id}`}
                            onChange={(event) =>
                              setDrawDateEdits((current) => ({
                                ...current,
                                [raffle.id]: event.target.value
                              }))
                            }
                            type="datetime-local"
                            value={drawDateEdits[raffle.id] ?? ""}
                          />
                        </div>
                      </div>
                      <button
                        className="button secondary"
                        disabled={!isAdmin || savingDrawDateId === raffle.id}
                        type="button"
                        onClick={() => saveRaffleDrawDate(raffle)}
                      >
                        <Save size={17} />
                        {savingDrawDateId === raffle.id ? "Salvando..." : "Salvar data"}
                      </button>
                    </div>

                    {drawResult ? (
                      <div className="winner-box">
                        <span className="pill green">
                          <Trophy size={15} />
                          Numero {drawResult.winningNumber}
                        </span>
                        <strong>{drawResult.buyerName ?? "Comprador sem nome"}</strong>
                        <span>{drawResult.buyerWhatsapp ?? "WhatsApp nao informado"}</span>
                        {winnerWhatsappLink ? (
                          <a
                            className="button secondary"
                            href={winnerWhatsappLink}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Phone size={17} />
                            Abrir WhatsApp
                          </a>
                        ) : null}
                        <span className="muted">
                          Contato:{" "}
                          {drawResult.buyerContact ??
                            drawResult.buyerEmail ??
                            "nao informado"}
                        </span>
                      </div>
                    ) : null}

                    {expandedRaffleId === raffle.id ? (
                      <div className="paid-number-list">
                        {loadingNumbersId === raffle.id ? (
                          <p className="muted">Carregando compradores...</p>
                        ) : paidNumbers.length === 0 ? (
                          <p className="muted">Nenhum numero pago ainda.</p>
                        ) : (
                          paidNumbers.map((item) => {
                            const link = whatsappHref(item.buyerWhatsapp);

                            return (
                              <div className="paid-number-row" key={item.id}>
                                <span className="paid-number">#{item.number}</span>
                                <div>
                                  <strong>{item.buyerName ?? "Comprador sem nome"}</strong>
                                  <p className="muted">
                                    WhatsApp: {item.buyerWhatsapp ?? "nao informado"}
                                  </p>
                                  <p className="muted">
                                    Contato:{" "}
                                    {item.buyerContact ?? item.buyerEmail ?? "nao informado"}
                                  </p>
                                </div>
                                {link ? (
                                  <a
                                    className="button secondary"
                                    href={link}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    <Phone size={17} />
                                    WhatsApp
                                  </a>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {drawModal ? (
        <div
          aria-label="Sorteio interativo"
          aria-modal="true"
          className="draw-modal-backdrop"
          role="dialog"
        >
          <div className="draw-modal">
            <div className="draw-modal-head">
              <div>
                <p className="eyebrow">Sorteio</p>
                <h2>{drawModal.raffleTitle}</h2>
              </div>
              <span
                className={`pill ${
                  drawModal.phase === "winner"
                    ? "green"
                    : drawModal.phase === "error"
                      ? "red"
                      : "blue"
                }`}
              >
                {drawModal.phase === "rolling" ? (
                  <Sparkles size={15} />
                ) : (
                  <Trophy size={15} />
                )}
                {drawModal.phase === "rolling"
                  ? "Girando"
                  : drawModal.phase === "winner"
                    ? "Vencedor"
                    : "Aviso"}
              </span>
            </div>

            {drawModal.phase === "rolling" ? (
              <>
                <div className="draw-number rolling">
                  {drawModal.displayNumber ?? "--"}
                </div>
                <p className="muted">
                  Girando entre {drawModal.candidateNumbers.length} numeros pagos.
                </p>
              </>
            ) : null}

            {drawModal.phase === "winner" && drawModal.result ? (
              <>
                <div className="draw-number winner">{drawModal.result.winningNumber}</div>
                <div className="draw-result">
                  <span className="pill green">
                    <Trophy size={15} />
                    Numero vencedor
                  </span>
                  <strong>{drawModal.result.buyerName ?? "Comprador sem nome"}</strong>
                  <span>{drawModal.result.buyerWhatsapp ?? "WhatsApp nao informado"}</span>
                  <span className="muted">
                    Contato:{" "}
                    {drawModal.result.buyerContact ??
                      drawModal.result.buyerEmail ??
                      "nao informado"}
                  </span>
                </div>
                <div className="draw-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setDrawModal(null)}
                  >
                    Fechar
                  </button>
                  {drawModalWhatsappLink ? (
                    <a
                      className="button"
                      href={drawModalWhatsappLink}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Phone size={17} />
                      Abrir WhatsApp
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}

            {drawModal.phase === "error" ? (
              <>
                <div className="message error">
                  {drawModal.error ?? "Nao foi possivel realizar o sorteio."}
                </div>
                <div className="draw-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setDrawModal(null)}
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
