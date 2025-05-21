# update-games
program to update Supabase data for steam games

## setup deno
### mac/linux
```
curl -fsSL https://deno.land/install.sh | sh
```
### windows
```
irm https://deno.land/install.ps1 | iex
```

## required variables
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_BUCKET
- API_KEY

## run command
```
deno run --allow-net --allow-env main.ts
```

## example use
```
curl -X POST -H 'Content-Type: application/json' -H 'x-api-key: API_KEY' -d {"appid":730}' http://localhost:8000
```