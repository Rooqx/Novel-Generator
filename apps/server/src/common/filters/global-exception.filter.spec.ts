import { type ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ErrorResponseBody,
	GlobalExceptionFilter,
	type HttpRequest,
	type HttpResponse,
} from "./global-exception.filter";

describe("GlobalExceptionFilter", () => {
	let filter: GlobalExceptionFilter;
	let mockResponse: HttpResponse;
	let mockRequest: HttpRequest;
	let mockHost: ArgumentsHost;
	let responseJson: unknown;

	beforeEach(() => {
		filter = new GlobalExceptionFilter();
		responseJson = undefined;

		mockResponse = {
			status: vi.fn().mockImplementation(() => {
				return mockResponse;
			}),
			json: vi.fn().mockImplementation((body: unknown) => {
				responseJson = body;
			}),
		};

		mockRequest = {
			url: "/api/test",
			method: "POST",
			headers: {
				"x-correlation-id": "test-corr-123",
			},
		};

		mockHost = {
			switchToHttp: () => ({
				getResponse: () => mockResponse,
				getRequest: () => mockRequest,
				getNext: vi.fn(),
			}),
		} as unknown as ArgumentsHost;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("formats HttpException properly and attaches correlation ID", () => {
		const exception = new HttpException("Bad Request", HttpStatus.BAD_REQUEST);
		filter.catch(exception, mockHost);

		expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
		const body = responseJson as ErrorResponseBody;
		expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
		expect(body.correlationId).toBe("test-corr-123");
		expect(body.message).toBe("Bad Request");
	});

	it("sanitizes unhandled Error in production mode to prevent information disclosure (OWASP API8)", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";

		const exception = new Error("Sensitive database connection details");
		filter.catch(exception, mockHost);

		expect(mockResponse.status).toHaveBeenCalledWith(
			HttpStatus.INTERNAL_SERVER_ERROR,
		);
		const body = responseJson as ErrorResponseBody;
		expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
		expect(body.message).toBe("Internal server error");

		process.env.NODE_ENV = originalEnv;
	});
});
