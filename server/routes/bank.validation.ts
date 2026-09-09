import { z } from "zod";

const boundedText = (max: number) => z.string().trim().max(max);

export const bankAccountCreateSchema = z
  .object({
    banco: boundedText(80).min(1),
    nome: boundedText(120).optional(),
    // The current admin form calls this field "descricao"; map it to the
    // required database column in the route after validation.
    descricao: boundedText(120).optional(),
    agencia: boundedText(40).optional(),
    conta: boundedText(60).optional(),
    clientId: boundedText(255).optional(),
    clientSecret: boundedText(500).optional(),
    ambiente: z.enum(["sandbox", "producao"]).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.nome || data.descricao), {
    message: "Nome ou descrição da conta é obrigatório",
    path: ["nome"],
  });

export const bankAccountUpdateSchema = z
  .object({
    banco: boundedText(80).min(1).optional(),
    nome: boundedText(120).optional(),
    descricao: boundedText(120).optional(),
    agencia: boundedText(40).optional(),
    conta: boundedText(60).optional(),
    clientId: boundedText(255).optional(),
    clientSecret: boundedText(500).optional(),
    ambiente: z.enum(["sandbox", "producao"]).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Nenhum campo atualizável informado",
  });

export const bankAccountIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const bankStatementQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const boletoSchema = z
  .object({
    valor: z.coerce.number().finite().positive(),
    vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sacadoNome: boundedText(120).min(1),
    sacadoCnpjCpf: boundedText(30).min(1),
    sacadoLogradouro: boundedText(120).min(1),
    sacadoCidade: boundedText(80).min(1),
    sacadoUf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    sacadoCep: boundedText(20).min(1),
    nossoNumero: boundedText(30).optional(),
    instrucoes: boundedText(200).optional(),
  })
  .strict();

export const reconciliationSchema = z.object({
  bankAccountId: z.coerce.number().int().positive(),
});