export type Order = any;

export type EditItem = {
  productId: number;
  quantity: number;
  unitPrice: number;
  subCategoryId: number | null;
  subCategoryName: string | null;
};
