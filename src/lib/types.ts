export type RaffleStatus = "draft" | "open" | "closed" | "drawn";
export type NumberStatus = "available" | "reserved" | "paid" | "cancelled";

export type Raffle = {
  id: string;
  title: string;
  description: string | null;
  prize_title: string;
  image_url: string | null;
  price_per_number: number;
  total_numbers: number;
  status: RaffleStatus;
  draw_at: string | null;
  winning_number: number | null;
  winner_order_id: string | null;
  drawn_at: string | null;
  created_at?: string;
};

export type RaffleNumber = {
  id: string;
  raffle_id: string;
  number: number;
  status: NumberStatus;
  reserved_until: string | null;
};

export type PixCheckout = {
  success: boolean;
  orderId?: string;
  copiaECola?: string;
  qrCodeBase64?: string;
  error?: string;
};

export type PaidRaffleNumber = {
  id: string;
  number: number;
  orderId: string | null;
  paidAt: string | null;
  buyerName: string | null;
  buyerWhatsapp: string | null;
  buyerContact: string | null;
  buyerEmail: string | null;
};

export type DrawResult = {
  raffleId: string;
  winningNumber: number;
  orderId: string | null;
  drawnAt: string | null;
  alreadyDrawn?: boolean;
  buyerName: string | null;
  buyerWhatsapp: string | null;
  buyerContact: string | null;
  buyerEmail: string | null;
};
