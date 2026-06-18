import { apiClient } from './client'
import type { LoginPayload, RegisterPayload, TokenPair, User } from '../types/auth'

export async function login(payload: LoginPayload): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>('/api/token/', payload)
  return data
}

export async function register(payload: RegisterPayload): Promise<User> {
  const { data } = await apiClient.post<User>('/api/accounts/register/', payload)
  return data
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get<User>('/api/accounts/me/')
  return data
}
