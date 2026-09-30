"""Reject unauthorised or oversized requests before FastAPI parses the body."""
import asyncio
import os

from fastapi import HTTPException
from fastapi.routing import APIRoute
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

import access


class BodyLimitError(Exception):
    pass


class RequestGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] == 'OPTIONS':
            return await self.app(scope, receive, send)
        path = scope['path']
        protected = path == '/analyze' or path.startswith('/tryon-') or path == '/auth/me'
        auth = path.startswith('/auth/')
        if not protected and not auth:
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        try:
            if protected:
                await asyncio.to_thread(access.require_account, headers.get('authorization'), headers.get('x-session-token'))
            else:
                access.require_app(headers.get('authorization'))
            limit = 8192 if auth else int(os.getenv('AI_MAX_REQUEST_BYTES', str(30 * 1024 * 1024)))
            length = headers.get('content-length')
            if length is not None:
                try:
                    size = int(length)
                except ValueError:
                    raise HTTPException(400, 'Некорректный размер запроса.')
                if size < 0 or size > limit:
                    raise HTTPException(413, 'Слишком большой запрос.')
            if scope['method'] == 'POST':
                mime = headers.get('content-type', '').split(';', 1)[0].lower()
                expected = 'application/json' if auth else 'multipart/form-data'
                if mime != expected:
                    raise HTTPException(415, 'Неподдерживаемый формат запроса.')
        except HTTPException as exc:
            return await JSONResponse({'detail': exc.detail}, exc.status_code)(scope, receive, send)
        received = 0
        async def limited_receive():
            nonlocal received
            message = await receive()
            if message['type'] == 'http.request':
                received += len(message.get('body', b''))
                if received > limit:
                    raise BodyLimitError()
            return message
        try:
            await self.app(scope, limited_receive, send)
        except BodyLimitError:
            await JSONResponse({'detail': 'Слишком большой запрос.'}, 413)(scope, receive, send)


class BoundedFormRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def bounded(request):
            if request.headers.get('content-type', '').lower().startswith('multipart/form-data'):
                # Cached on Request; FastAPI reuses this bounded parse.
                # The photo and up to six garments: four upper layers, trousers and shoes.
                await request.form(max_files=7, max_fields=16, max_part_size=8192)
            return await handler(request)
        return bounded
