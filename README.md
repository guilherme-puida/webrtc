# WebRTC

Para rodar, você precisa ter o [Deno] instalado.

[Deno]: https://deno.com/

Então, `deno task dev` inicia o servidor. Você pode acessá-lo em:
`https://0.0.0.0:8000`

## Gerar Certificados

Caso precise gerar novamente os certificados, use [mkcert]:

```
mkcert -cert-file ./tls/cert.pem -key-file ./tls/key.pem '0.0.0.0'
```

[mkcert]: https://github.com/FiloSottile/mkcert 
