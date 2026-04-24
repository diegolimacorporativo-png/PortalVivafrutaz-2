#!/usr/bin/env python3
"""
Script para obter URL do Ngrok via API local
"""
import time
import requests
import json

def get_ngrok_url():
    """Obtém a URL pública do Ngrok via API local"""
    max_retries = 30
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            # API local do Ngrok na porta 4040
            response = requests.get('http://localhost:4040/api/tunnels', timeout=5)
            if response.status_code == 200:
                data = response.json()
                tunnels = data.get('tunnels', [])
                
                if tunnels:
                    for tunnel in tunnels:
                        if tunnel.get('proto') == 'https':
                            url = tunnel.get('public_url')
                            if url:
                                return url
                                
        except Exception as e:
            print(f"Tentativa {retry_count + 1}/{max_retries}: Aguardando Ngrok... ({str(e)[:50]})")
        
        retry_count += 1
        time.sleep(1)
    
    return None

if __name__ == '__main__':
    print("\n🚀 Aguardando URL do Ngrok...")
    print("=" * 60)
    
    url = get_ngrok_url()
    
    if url:
        print(f"\n✅ URL Pública Ngrok: {url}\n")
        print("📱 Link público HTTPS:")
        print(f"   {url}")
        print("\n🌐 Acesso ao ERP VivaFrutaz:")
        print(f"   Clara IA: {url}/test-clara")
        print(f"   NF Manual: {url}/admin/insert-nf-manual")
        print(f"   API Chat: {url}/api/clara/chat")
        print("\n💻 Testes recomendados:")
        print(f"   Desktop Local: http://localhost:5000/test-clara")
        print(f"   Celular: {url}/test-clara")
        print("\n" + "=" * 60)
    else:
        print("\n❌ Não conseguiu obter URL do Ngrok após 30 segundos")
        print("Verifique se:")
        print("  1. Ngrok está rodando (ngrok http 5000)")
        print("  2. A porta 4040 está acessível (API do Ngrok)")
