import type { ClientDetail, ClientSummary } from '../types/client'

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const clientSummaries: ClientSummary[] = [
  {
    id: 1,
    client_type: 'legal_entity',
    status: 'active',
    display_name: 'Acme Ltd',
    company_id: 10,
  },
  {
    id: 2,
    client_type: 'individual',
    status: 'inactive',
    display_name: 'Jane Doe',
    company_id: 10,
  },
]

export const clientDetail: ClientDetail = {
  id: 1,
  client_type: 'legal_entity',
  status: 'active',
  company_id: 10,
  individual: null,
  legal_entity: {
    legal_name: 'Acme Ltd',
    trading_name: 'Acme Trading',
    voen: '1234567890',
    registration_number: 'REG-1',
    registration_date: '2020-01-01',
  },
  addresses: [
    {
      id: 1,
      address_type: 1,
      address_type_code: 'billing',
      line1: 'Main St 1',
      line2: null,
      city: 'Baku',
      region: null,
      postal_code: null,
      country_code: 'AZ',
      is_primary: true,
    },
  ],
  contacts: [
    {
      id: 1,
      full_name: 'Alice Manager',
      position: 'CEO',
      phone: '+994000000000',
      email: 'alice@acme.az',
      is_primary: true,
    },
  ],
  bank_accounts: [
    {
      id: 1,
      bank: 1,
      bank_name: 'Test Bank',
      currency: 1,
      currency_code: 'AZN',
      iban: 'AZ00TEST0000000000',
      swift_bic: null,
      is_default: true,
    },
  ],
  created_at: '2026-09-01T10:00:00+00:00',
}