import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { createProduct } from '../services/product/productService';
import { deleteProduct } from '../services/product/deleteProductService';
import { runSalesOsWorker } from '../services/jobs/workerService';
import { parseProductSource } from '../services/product/sourceParser';
import { extractPdfText } from '../services/product/pdfImport';
import type { ProductImportDraft } from '../services/product/markdownImport';
import type { ProductSourceInput } from '../services/product/sourceService';
import { deriveProductWorkflowView } from '../services/product/workflowState';
import { PageHeader } from './designSystem';

type Product = {
  id: string;
  name: string;
  slug: string;
  status: string;
  website_url: string | null;
  description_input: string | null;
  workflow?: {
    hasProfile: boolean;
    profileApproved: boolean;
    proposedOutreachCount: number;
    approvedOutreachCount: number;
    generatedCopyCount: number;
    pendingCopyApprovalCount: number;
  };
};
type Job = {
  id: string;
  product_id: string;
  job_type: string;
  workflow_stage: string | null;
  status: string;
  error: Record<string, unknown> | null;
  progress: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
  next_run_at: string | null;
  last_heartbeat_at: string | null;
  cancel_requested: boolean;
};

type ProductForm = {
  name: string;
  websiteUrl: string;
};

const emptyForm: ProductForm = {
  name: '',
  websiteUrl: '',
};

export function ProductsPage({ actor }: { actor: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importPhase, setImportPhase] = useState<
    'idle' | 'file_selected' | 'importing' | 'parsing' | 'parsed' | 'failed'
  >('idle');
  const [importedSource, setImportedSource] = useState<ProductSourceInput | null>(null);
  const [sourceContent, setSourceContent] = useState('');
  const [showAddForm, setShowAddForm] = useState(searchParams.get('add') === '1');

  async function loadProducts() {
    const [
      { data, error: loadError },
      { data: jobData, error: jobError },
      { data: profileData, error: profileError },
      { data: decisionData, error: decisionError },
      { data: engagementData, error: engagementError },
    ] = await Promise.all([
      supabaseBrowserClient
        .from('sales_os_products')
        .select('id, name, slug, status, website_url, description_input')
        .eq('tenant_id', 'sales_os')
        .order('created_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_jobs')
        .select(
          'id, product_id, job_type, workflow_stage, status, error, progress, attempt, max_attempts, next_run_at, last_heartbeat_at, cancel_requested',
        )
        .eq('tenant_id', 'sales_os')
        .in('status', [
          'queued',
          'running',
          'paused_budget',
          'failed',
          'waiting_approval',
          'cancelled',
        ])
        .order('created_at', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_product_profiles')
        .select('product_id, review_status, version')
        .eq('tenant_id', 'sales_os')
        .order('version', { ascending: false }),
      supabaseBrowserClient
        .from('sales_os_outreach_decisions')
        .select('product_id, status')
        .eq('tenant_id', 'sales_os'),
      supabaseBrowserClient
        .from('sales_os_engagements')
        .select('product_id, status')
        .eq('tenant_id', 'sales_os'),
    ]);
    if (loadError || jobError || profileError || decisionError || engagementError)
      setError(
        (loadError ?? jobError ?? profileError ?? decisionError ?? engagementError)
          ?.message ?? 'Unable to load products.',
      );
    else {
      const latestProfileByProduct = new Map<string, { review_status: string }>();
      for (const row of profileData ?? []) {
        if (!latestProfileByProduct.has(row.product_id))
          latestProfileByProduct.set(row.product_id, row);
      }
      const productsWithWorkflow = ((data ?? []) as Product[]).map((product) => {
        const profile = latestProfileByProduct.get(product.id);
        const decisions = (decisionData ?? []).filter(
          (row) => row.product_id === product.id,
        );
        const engagements = (engagementData ?? []).filter(
          (row) => row.product_id === product.id,
        );
        return {
          ...product,
          workflow: {
            hasProfile: Boolean(profile),
            profileApproved: profile?.review_status === 'approved',
            proposedOutreachCount: decisions.filter((row) => row.status === 'proposed')
              .length,
            approvedOutreachCount: decisions.filter((row) => row.status === 'approved')
              .length,
            generatedCopyCount: engagements.filter((row) =>
              [
                'drafted',
                'awaiting_approval',
                'approved',
                'queued',
                'executed',
              ].includes(row.status),
            ).length,
            pendingCopyApprovalCount: engagements.filter(
              (row) => row.status === 'awaiting_approval',
            ).length,
          },
        };
      });
      setProducts(productsWithWorkflow);
      setJobs((jobData ?? []) as Job[]);
    }
  }

  async function handleDeleteProduct(product: Product) {
    const confirmed = window.confirm(
      `Delete “${product.name}” and all related audiences, routes, opportunities, engagements, jobs, events, and analytics? This cannot be undone.`,
    );
    if (!confirmed) return;
    const typedName = window.prompt(
      `Type the product name to confirm deletion:\n${product.name}`,
    );
    if (typedName !== product.name) {
      setError('Product deletion cancelled because the name did not match.');
      return;
    }
    setError(null);
    setBusyProductId(product.id);
    try {
      await deleteProduct(product.id, typedName);
      await loadProducts();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Product deletion failed.',
      );
    } finally {
      setBusyProductId(null);
    }
  }

  useEffect(() => {
    void loadProducts(); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = window.setInterval(() => {
      void loadProducts();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const content = sourceContent.trim();
      if (!content)
        throw new Error('Import a document or paste product information first.');
      const parsedFields =
        importedSource?.parsedFields ??
        parseProductSource('pasted-product.md', content, 'text/markdown');
      const parsedRecord = parsedFields as Record<string, unknown>;
      const parsedName = typeof parsedRecord.name === 'string' ? parsedRecord.name : '';
      const parsedWebsite =
        typeof parsedRecord.websiteUrl === 'string' ? parsedRecord.websiteUrl : '';
      const parsedValue = (key: keyof ProductImportDraft) =>
        typeof parsedRecord[key] === 'string' ? parsedRecord[key] : '';
      const productName = form.name.trim() || parsedName || 'Imported product';
      const websiteUrl = form.websiteUrl.trim() || parsedWebsite;
      const source: ProductSourceInput = importedSource
        ? { ...importedSource, content }
        : {
            sourceType: 'free_text',
            content,
            parsedFields,
          };
      const { product } = await createProduct(
        supabaseBrowserClient,
        {
          name: productName,
          websiteUrl,
          descriptionInput: content,
          pricingBusinessModel: parsedValue('pricingBusinessModel'),
          primaryObjective: parsedValue('primaryObjective'),
          geographicConstraints: parsedValue('geographicConstraints'),
          knownAudiences: parsedValue('knownAudiences'),
          additionalContext: parsedValue('additionalContext'),
          monthlySpendCap: null,
          perRunSpendCap: null,
          currency: 'USD',
        },
        actor,
        source,
      );
      await runSalesOsWorker();
      setForm(emptyForm);
      setImportedSource(null);
      setSourceContent('');
      setImportStatus(null);
      setImportPhase('idle');
      setShowAddForm(false);
      navigate(`/sales-os/products/${product.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Product creation failed.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  function updateField(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleMarkdownImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setImportPhase('file_selected');
    setImportStatus(`Selected ${file.name}. Importing source material…`);
    try {
      setImportPhase('importing');
      const sourceText =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
          ? await extractPdfText(file)
          : await file.text();
      setImportPhase('parsing');
      const imported = parseProductSource(file.name, sourceText, file.type);
      setForm((current) => ({
        name: current.name || imported.name,
        websiteUrl: current.websiteUrl || imported.websiteUrl,
      }));
      setSourceContent(sourceText);
      setImportedSource({
        sourceType: 'file',
        fileName: file.name,
        mimeType: file.type || 'text/markdown',
        content: sourceText,
        parsedFields: imported,
      });
      setImportStatus(
        `Parsed ${file.name}. Review and edit the extracted content before creating the product.`,
      );
      setImportPhase('parsed');
    } catch (importError) {
      setImportPhase('failed');
      setError(
        importError instanceof Error
          ? importError.message
          : 'Unable to parse Markdown file.',
      );
    } finally {
      event.target.value = '';
    }
  }

  return (
    <section className="page-section product-page">
      <PageHeader
        eyebrow="Workspace portfolio"
        title="Products"
        purpose="Import product information, then review the generated Product Sales Profile."
        action={
          <button type="button" onClick={() => setShowAddForm(true)}>
            Add product
          </button>
        }
      />
      <div className={`product-layout ${showAddForm ? '' : 'portfolio-only'}`}>
        {showAddForm && (
          <form className="panel stack" onSubmit={handleSubmit}>
            <h3>Import product information</h3>
            <div className="import-panel">
              <strong>Start with a document or pasted text</strong>
              <p className="muted">
                Upload a PRD, FAQ, one-pager, or paste a product brief. Sales OS will
                parse the material and build the Product Sales Profile for review.
              </p>
              <label className="file-input-label">
                Choose source file
                <input
                  type="file"
                  accept=".md,.markdown,.txt,.json,.csv,.pdf,.doc,.docx,text/*,application/json,application/pdf"
                  onChange={(event) => void handleMarkdownImport(event)}
                />
              </label>
              <span className="muted">
                Import state: {importPhase.replace('_', ' ')}
              </span>
              {importStatus && (
                <p className="success" role="status">
                  {importStatus}
                </p>
              )}
              <label>
                Product document or free text
                <textarea
                  rows={12}
                  value={sourceContent}
                  onChange={(event) => {
                    const content = event.target.value;
                    setSourceContent(content);
                    setImportedSource((current) =>
                      current ? { ...current, content } : current,
                    );
                    if (content && importPhase === 'idle') setImportPhase('parsed');
                  }}
                  placeholder="Paste your PRD, FAQ, product brief, or product context here…"
                  required
                />
              </label>
            </div>
            <label>
              Product name <span className="muted">(optional override)</span>
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Sales OS will infer this from the source"
              />
            </label>
            <label>
              Website URL <span className="muted">(optional override)</span>
              <input
                type="url"
                value={form.websiteUrl}
                onChange={(event) => updateField('websiteUrl', event.target.value)}
                placeholder="https://example.com"
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Parsing and building profile…' : 'Parse and build profile'}
            </button>
          </form>
        )}
        <div className="stack">
          <div className="section-heading">
            <div>
              <span className="field-label">Portfolio</span>
              <h3>Your products</h3>
            </div>
            <span className="count-badge">{products.length}</span>
          </div>
          {products.length === 0 ? (
            <div className="empty-state">
              No products yet. Add the first product to begin Product → Audience.
            </div>
          ) : (
            products.map((product) => (
              <div className="product-card" key={product.id}>
                <Link to={`/sales-os/products/${product.id}`}>
                  <div>
                    <strong>{product.name}</strong>
                    <span className="muted">{product.website_url ?? product.slug}</span>
                  </div>
                  {(() => {
                    const productJobs = jobs.filter(
                      (job) => job.product_id === product.id,
                    );
                    const workflow = deriveProductWorkflowView({
                      productStatus: product.status,
                      hasInput: Boolean(
                        product.website_url || product.description_input,
                      ),
                      hasProfile: product.workflow?.hasProfile ?? false,
                      profileApproved: product.workflow?.profileApproved ?? false,
                      activeJobCount: productJobs.filter((job) =>
                        ['queued', 'running'].includes(job.status),
                      ).length,
                      failedJobCount: productJobs.filter(
                        (job) => job.status === 'failed',
                      ).length,
                      proposedOutreachCount: product.workflow?.proposedOutreachCount,
                      approvedOutreachCount: product.workflow?.approvedOutreachCount,
                      generatedCopyCount: product.workflow?.generatedCopyCount,
                      pendingCopyApprovalCount:
                        product.workflow?.pendingCopyApprovalCount,
                    });
                    return (
                      <span className="product-workflow-status">
                        <span className="status-pill">{workflow.label}</span>
                        <small className="muted">{workflow.nextAction}</small>
                      </span>
                    );
                  })()}
                </Link>
                <button
                  type="button"
                  className="button-danger"
                  disabled={busyProductId === product.id}
                  onClick={() => void handleDeleteProduct(product)}
                >
                  {busyProductId === product.id ? 'Deleting…' : 'Delete product'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
