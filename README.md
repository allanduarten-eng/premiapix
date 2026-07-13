# PremiaPix - Rifas Online com PIX

Sistema Next.js com Supabase, painel admin, checkout PIX via Mercado Pago,
webhook de confirmacao e sorteio por numeros pagos.

## 1. Configurar variaveis

Copie `.env.example` para `.env.local` e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua_publishable_key
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key

MERCADO_PAGO_ACCESS_TOKEN=seu_token_mercado_pago
MERCADO_PAGO_DEFAULT_PAYER_EMAIL=comprador@premiapix.app
MERCADO_PAGO_WEBHOOK_URL=https://seu-dominio.com/api/webhooks/mercado-pago
MERCADO_PAGO_WEBHOOK_SECRET=seu_segredo_do_webhook
```

A publishable key pode ir para o navegador. A `SUPABASE_SERVICE_ROLE_KEY`,
o `MERCADO_PAGO_ACCESS_TOKEN` e o `MERCADO_PAGO_WEBHOOK_SECRET` ficam somente
no servidor.

O comprador nao precisa informar e-mail na tela. O Mercado Pago exige
`payer.email` para criar o PIX, entao o backend usa
`MERCADO_PAGO_DEFAULT_PAYER_EMAIL` quando nenhum e-mail for informado.

## 2. Conectar no Supabase

Como o PowerShell deste computador bloqueia `npm.ps1`, use `npm.cmd` e
`npx.cmd`.

```powershell
cd "C:\Users\DELL\Documents\New project\premiapix-allan"
npx.cmd supabase login
npx.cmd supabase link --project-ref SEU_PROJECT_REF
npx.cmd supabase db push
```

Se quiser instalar a CLI globalmente:

```powershell
npm.cmd install -g supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

## 3. Criar o primeiro administrador

1. Crie ou atualize o usuario em **Authentication > Users** no Supabase.
2. Se o envio de e-mail estiver limitado, defina uma senha para o usuario e use
   o login por senha em `/admin`.
3. Copie o `id` do usuario.
4. Rode no SQL Editor:

```sql
insert into public.admins (user_id)
values ('COLE_O_UUID_DO_USUARIO_AQUI')
on conflict do nothing;
```

Ou, se o e-mail ja existir em `auth.users`:

```sql
insert into public.admins (user_id)
select id
from auth.users
where email = 'admin@email.com'
on conflict do nothing;
```

## 4. Rodar localmente

```powershell
npm.cmd install
npm.cmd run dev
```

Abra `http://localhost:3000`.

## 5. Rotas importantes

- `/` - vitrine publica para comprar numeros.
- `/admin` - painel para criar campanhas, consultar compradores e sortear.
- `/api/checkout/pix` - cria pedido, reserva numeros e gera pagamento PIX.
- `/api/webhooks/mercado-pago` - confirma pagamento aprovado e marca numeros
  como pagos.

## 6. Mercado Pago

Use primeiro credenciais de teste em `MERCADO_PAGO_ACCESS_TOKEN`. No painel do
Mercado Pago, configure Webhooks para o evento de pagamentos e use uma URL HTTPS
publica:

```text
https://seu-dominio.com/api/webhooks/mercado-pago
```

Depois de salvar o webhook, copie a assinatura secreta gerada pelo Mercado Pago
para `MERCADO_PAGO_WEBHOOK_SECRET`. Com essa variavel configurada, o endpoint
valida a origem da notificacao antes de atualizar pedidos.

Como o checkout PIX e transparente, o comprador nao sai do PremiaPix. Se o
painel pedir uma URL de redirecionamento da aplicacao, use a URL publica da
vitrine.

## 7. Producao

Antes de vender:

- Usar dominio HTTPS em `MERCADO_PAGO_WEBHOOK_URL`.
- Trocar credenciais de teste por credenciais de producao.
- Criar pelo menos um admin no Supabase.
- Confirmar que a tabela `admins` tem o usuario correto.
- Criar uma campanha pequena de teste e simular um pagamento PIX.
- Verificar no painel admin se o numero pago aparece em **Compradores**.
