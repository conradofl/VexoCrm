import { test, expect } from '@playwright/test';

test('LivPub Instance Setup Workflow', async ({ page }) => {
  // O timeout pode voltar ao padrão normal já que o login é automatizado
  test.setTimeout(90000); 

  console.log("👉 Acessando o Vexo OS...");
  await page.goto('/login');
  
  // 1. Automatizando o Login
  console.log("👉 Realizando login automático...");
  await page.getByLabel('E-mail').fill('conradofl@gmail.com'); 
  await page.getByLabel('Senha').fill('@Vexo2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  
  // Aguarda o login concluir e a navegação para o CRM ocorrer
  await page.waitForURL('**/crm/**', { timeout: 30000 });
  console.log("✅ Login realizado com sucesso!");

  // 2. Criação da Empresa (Tenant)
  console.log("👉 Navegando para o gerenciamento de empresas...");
  await page.goto('/crm/empresas');
  
  await page.getByRole('button', { name: 'Nova empresa' }).click();
  
  const uniqueId = `livpub-${Date.now()}`;
  const companyName = `LivPub ${Date.now().toString().slice(-4)}`;

  // Preencher Modal de Nova Empresa
  console.log("👉 Preenchendo dados da nova empresa...");
  await page.getByLabel('Nome da empresa').fill(companyName);
  await page.getByLabel('Tenant ID').fill(uniqueId);
  
  await page.getByRole('button', { name: 'Criar empresa e tabela' }).click();
  
  // Aguardar o modal de criação fechar
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
  
  // Verificar se a empresa foi listada na tabela/grid
  await expect(page.locator(`text=${uniqueId}`).first()).toBeVisible({ timeout: 15000 });
  console.log(`✅ Empresa ${companyName} criada no banco de dados e tabela de leads gerada.`);

  // 3. Conectar Chip (Evolution API)
  console.log("👉 Navegando para aba de conexões e selecionando a empresa LivPub...");
  await page.goto('/crm/conexoes');
  
  // Selecionar a empresa recém criada no Navbar
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: companyName }).click();
  
  // Aguardar a página recarregar com a empresa selecionada
  await expect(page.getByText('Chips WhatsApp Conectados')).toBeVisible({ timeout: 15000 });

  // Preencher dados do novo chip
  console.log("👉 Gerando nova instância Evolution...");
  await page.getByPlaceholder('Ex: chip-vendas-financeiro').fill('chip-livpub-oficial');
  await page.getByRole('button', { name: 'Gerar QR Code de Pareamento' }).click();

  // 4. Pausa apenas para ler o QR Code
  console.log('\n=========================================');
  console.log('✅ Instância LivPub solicitada à Evolution API.');
  console.log('⚠️ TESTE EM PAUSA PARA LER O QR CODE ⚠️');
  console.log('1. O modal do QR code deve abrir na tela (pode demorar alguns segundos).');
  console.log('2. Conecte o QR Code: Abra o WhatsApp no celular e leia o código.');
  console.log('3. ATENÇÃO À PLANILHA: Hoje (26/06) é dia de Coleta de acessos.');
  console.log('=========================================\n');
  
  await page.pause();
});
