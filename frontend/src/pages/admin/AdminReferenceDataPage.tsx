import { useState } from 'react'

import {
  createAdminAddressType,
  createAdminCurrency,
  createAdminDocumentType,
  deleteAdminAddressType,
  deleteAdminCurrency,
  deleteAdminDocumentType,
  listAdminAddressTypes,
  listAdminCurrencies,
  listAdminDocumentTypes,
  updateAdminAddressType,
  updateAdminCurrency,
  updateAdminDocumentType,
} from '../../api/adminReferenceData'
import { PageContainer } from '../../components/ui/PageContainer'
import { BanksSection } from './referenceData/BanksSection'
import { ExchangeRatesSection } from './referenceData/ExchangeRatesSection'
import { SimpleCatalogSection } from './referenceData/SimpleCatalogSection'
import { VatRatesSection } from './referenceData/VatRatesSection'

type TabKey =
  | 'currencies'
  | 'document-types'
  | 'address-types'
  | 'vat-rates'
  | 'banks'
  | 'exchange-rates'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'currencies', label: 'Currencies' },
  { key: 'document-types', label: 'Document Types' },
  { key: 'address-types', label: 'Address Types' },
  { key: 'vat-rates', label: 'VAT Rates' },
  { key: 'banks', label: 'Banks' },
  { key: 'exchange-rates', label: 'Exchange Rates' },
]

/**
 * System Admin reference-data administration.
 *
 * Reference data is global application data (never tenant-owned). Each catalog
 * exposes only the operations the backend supports: currencies, document types,
 * address types, and VAT rates support create/update/delete; banks support
 * create/update + activate/deactivate; exchange rates are read-only.
 */
export function AdminReferenceDataPage() {
  const [active, setActive] = useState<TabKey>('currencies')

  return (
    <PageContainer title="Reference Data">
      <div className="space-y-6">
        <p className="text-sm text-slate-500">
          Global reference catalogs shared by every company. These records are
          not tenant-owned and are not editable by company users.
        </p>

        <div
          role="tablist"
          aria-label="Reference data catalogs"
          className="flex flex-wrap gap-2 border-b border-slate-200"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              onClick={() => setActive(tab.key)}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                active === tab.key
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {active === 'currencies' ? (
          <SimpleCatalogSection
            title="Currencies"
            description="ISO 4217 currencies available to companies."
            addLabel="New currency"
            emptyMessage="No currencies yet."
            fields={[
              { name: 'code', label: 'Code', required: true, placeholder: 'USD' },
              { name: 'name', label: 'Name', required: true, placeholder: 'US Dollar' },
              { name: 'minor_unit', label: 'Minor unit', type: 'number', required: true },
            ]}
            columns={[
              { header: 'Code', render: (row) => row.code },
              { header: 'Name', render: (row) => row.name },
              { header: 'Minor unit', render: (row) => row.minor_unit },
            ]}
            list={listAdminCurrencies}
            create={(v) =>
              createAdminCurrency({
                code: v.code,
                name: v.name,
                minor_unit: Number(v.minor_unit),
              })
            }
            update={(id, v) =>
              updateAdminCurrency(id, {
                code: v.code,
                name: v.name,
                minor_unit: Number(v.minor_unit),
              })
            }
            remove={deleteAdminCurrency}
            getId={(row) => row.id}
            toFormValues={(row) => ({
              code: row.code,
              name: row.name,
              minor_unit: String(row.minor_unit),
            })}
          />
        ) : null}

        {active === 'document-types' ? (
          <SimpleCatalogSection
            title="Document Types"
            description="Document categories used by templates and generated documents."
            addLabel="New document type"
            emptyMessage="No document types yet."
            fields={[
              { name: 'code', label: 'Code', required: true },
              { name: 'name', label: 'Name', required: true },
            ]}
            columns={[
              { header: 'Code', render: (row) => row.code },
              { header: 'Name', render: (row) => row.name },
            ]}
            list={listAdminDocumentTypes}
            create={(v) => createAdminDocumentType({ code: v.code, name: v.name })}
            update={(id, v) => updateAdminDocumentType(id, { code: v.code, name: v.name })}
            remove={deleteAdminDocumentType}
            getId={(row) => row.id}
            toFormValues={(row) => ({ code: row.code, name: row.name })}
          />
        ) : null}

        {active === 'address-types' ? (
          <SimpleCatalogSection
            title="Address Types"
            description="Address classifications used by client addresses."
            addLabel="New address type"
            emptyMessage="No address types yet."
            fields={[{ name: 'code', label: 'Code', required: true }]}
            columns={[{ header: 'Code', render: (row) => row.code }]}
            list={listAdminAddressTypes}
            create={(v) => createAdminAddressType({ code: v.code })}
            update={(id, v) => updateAdminAddressType(id, { code: v.code })}
            remove={deleteAdminAddressType}
            getId={(row) => row.id}
            toFormValues={(row) => ({ code: row.code })}
          />
        ) : null}

        {active === 'vat-rates' ? <VatRatesSection /> : null}
        {active === 'banks' ? <BanksSection /> : null}
        {active === 'exchange-rates' ? <ExchangeRatesSection /> : null}
      </div>
    </PageContainer>
  )
}
