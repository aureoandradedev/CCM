-- Produtos de TESTE a R$ 0,01 para validar checkout, Pix e cartão.
-- Rode DEPOIS de 0001_init.sql e seed.sql (usa as categorias/fornecedores do seed).
-- Para remover depois: delete from public.products where id like 'teste-%';
begin;

insert into public.brands (slug, name) values ('multigiro-teste', 'Multigiro Teste') on conflict (slug) do nothing;

insert into public.products
  (id, slug, sku, name, brand_slug, brand_name, category_slug, supplier_id, unit, pack_info, retail_price, wholesale_price, wholesale_min_qty, list_price, images, badges, short_description, description, stock_status, tags, sort, active)
values
  ('teste-01', 'teste-cimento-1-centavo', 'TST-001', 'TESTE Cimento CP II 50 kg', 'multigiro-teste', 'Multigiro Teste', 'materiais-basicos', 'sup-serra', 'saco', 'Saco 50 kg', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -100, true),
  ('teste-02', 'teste-argamassa-1-centavo', 'TST-002', 'TESTE Argamassa AC-II 20 kg', 'multigiro-teste', 'Multigiro Teste', 'materiais-basicos', 'sup-serra', 'saco', 'Saco 20 kg', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -99, true),
  ('teste-03', 'teste-porcelanato-1-centavo', 'TST-003', 'TESTE Porcelanato 60x60 cm', 'multigiro-teste', 'Multigiro Teste', 'pisos-e-revestimentos', 'sup-ceramica', 'm²', 'Caixa com 1,44 m²', 0.01, null, null, 0.05, '{}', '{oferta}', 'Produto de teste a R$ 0,01 (oferta de R$ 0,05) para validar selo de oferta.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -98, true),
  ('teste-04', 'teste-tinta-1-centavo', 'TST-004', 'TESTE Tinta Acrílica 18 L', 'multigiro-teste', 'Multigiro Teste', 'tintas-e-acessorios', 'sup-sulcap', 'lata', 'Lata 18 L', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -97, true),
  ('teste-05', 'teste-tubo-pvc-1-centavo', 'TST-005', 'TESTE Tubo PVC 100 mm 6 m', 'multigiro-teste', 'Multigiro Teste', 'hidraulica', 'sup-hidra', 'un', 'Barra 6 m', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -96, true),
  ('teste-06', 'teste-cabo-1-centavo', 'TST-006', 'TESTE Cabo Flexível 2,5 mm 100 m', 'multigiro-teste', 'Multigiro Teste', 'eletrica', 'sup-eletrica', 'rolo', 'Rolo 100 m', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -95, true),
  ('teste-07', 'teste-vaso-1-centavo', 'TST-007', 'TESTE Vaso Sanitário com Caixa Acoplada', 'multigiro-teste', 'Multigiro Teste', 'loucas-e-metais', 'sup-hidra', 'un', 'Kit completo', 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -94, true),
  ('teste-08', 'teste-furadeira-1-centavo', 'TST-008', 'TESTE Furadeira de Impacto 650 W', 'multigiro-teste', 'Multigiro Teste', 'ferramentas', 'sup-sulcap', 'un', null, 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -93, true),
  ('teste-09', 'teste-telha-1-centavo', 'TST-009', 'TESTE Telha de Fibrocimento 2,44 m', 'multigiro-teste', 'Multigiro Teste', 'telhas-e-coberturas', 'sup-serra', 'un', null, 0.01, null, null, null, '{}', '{novo}', 'Produto de teste a R$ 0,01 para validar o checkout.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -92, true),
  ('teste-10', 'teste-tijolo-atacado-1-centavo', 'TST-010', 'TESTE Tijolo Cerâmico 9 furos (atacado a partir de 10)', 'multigiro-teste', 'Multigiro Teste', 'materiais-basicos', 'sup-serra', 'un', null, 0.02, 0.01, 10, null, '{}', '{atacado}', 'Produto de teste: R$ 0,02 no varejo e R$ 0,01 no atacado a partir de 10 un.', 'Produto fictício. Não será entregue.', 'supplier', '{teste}', -91, true)
on conflict (id) do update set
  retail_price = excluded.retail_price, wholesale_price = excluded.wholesale_price, wholesale_min_qty = excluded.wholesale_min_qty,
  list_price = excluded.list_price, active = true, sort = excluded.sort;

commit;
