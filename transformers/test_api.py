#!/usr/bin/env python3
"""
Test script for the FastAPI Transformer Models Microservice
Tests all endpoints with sample data
"""

import asyncio
import time
import json
import os
import httpx
from typing import Dict, Any
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API base URL
BASE_URL = "http://localhost:8001"

# Authentication token
AUTH_TOKEN = os.getenv(
    "AUTH_TOKEN", "default-dev-token-change-in-production-min-32-chars"
)
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "true").lower() == "true"


# Headers for authenticated requests
def get_headers():
    """Get headers with authentication if required"""
    if AUTH_REQUIRED:
        return {"Authorization": f"Bearer {AUTH_TOKEN}"}
    return {}


# Test data for each endpoint
TEST_DATA = {
    "sentiment": [
        {"text": "I love this new feature! It's amazing!"},
        {"text": "Covid cases are increasing fast!"},
        {"text": "The weather is nice today."},
        {"text": "I'm feeling frustrated with this situation."},
        {"text": "@john Thanks for sharing! Check out http://example.com"},
    ],
    "toxicity": [
        {"text": "This is a normal, friendly comment."},
        {"text": "I disagree with your opinion, but respect your right to have it."},
        {"text": "Muslims are people who follow Islam."},
        {"text": "The weather is nice today."},
        {"text": "Thanks for the helpful information!"},
    ],
    "emotion": [
        {"text": "I am so excited about this new opportunity!"},
        {"text": "I'm feeling really sad about the news."},
        {"text": "This situation makes me angry."},
        {"text": "I'm terrified of what might happen."},
        {"text": "What a pleasant surprise this is!"},
        {"text": "I feel disgusted by this behavior."},
        {"text": "Everything seems normal today."},
    ],
    "sequence": [
        {
            "text": "This movie was absolutely fantastic! Great acting and storyline.",
            "candidate_labels": [
                "positive review",
                "negative review",
                "neutral review",
            ],
        },
        {
            "text": "The customer service was terrible and unhelpful.",
            "candidate_labels": ["complaint", "compliment", "inquiry"],
        },
        {
            "text": "Can you please help me with my account settings?",
            "candidate_labels": [
                "technical support",
                "billing question",
                "general inquiry",
            ],
        },
        {
            "text": "The new policy will increase productivity and reduce costs.",
            "candidate_labels": ["business", "technology", "healthcare", "education"],
        },
    ],
}


async def test_health_check():
    """Test the health check endpoint"""
    print("🏥 Testing Health Check...")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/health", headers=get_headers())
            response.raise_for_status()

            data = response.json()
            print(f"   Status: {data['status']}")
            print(f"   Models loaded: {', '.join(data['models_loaded'])}")
            print(f"   Message: {data['message']}")

            # Display cache information
            cache_info = data.get("cache_info", {})
            if cache_info:
                print(
                    f"   💾 Cache directory: {cache_info.get('cache_directory', 'Unknown')}"
                )
                if cache_info.get("cache_exists"):
                    if "cache_size_mb" in cache_info:
                        print(
                            f"   📦 Cache size: {cache_info['cache_size_mb']} MB ({cache_info.get('cached_files', 0)} files)"
                        )
                    if cache_info.get("error"):
                        print(f"   ⚠️  Cache warning: {cache_info['error']}")
                else:
                    print(f"   📁 Cache not found - will be created on model load")

            print("   ✅ Health check passed!")
            return True

        except Exception as e:
            print(f"   ❌ Health check failed: {str(e)}")
            return False


async def test_endpoint(endpoint: str, test_cases: list):
    """Test a specific endpoint with test cases"""
    print(f"\n🧪 Testing /{endpoint} endpoint...")

    async with httpx.AsyncClient(timeout=30.0) as client:
        success_count = 0
        total_time = 0

        for i, test_case in enumerate(test_cases, 1):
            try:
                print(f"\n   Test {i}: \"{test_case.get('text', 'N/A')}\"")

                start_time = time.time()
                response = await client.post(
                    f"{BASE_URL}/{endpoint}", json=test_case, headers=get_headers()
                )
                end_time = time.time()

                response.raise_for_status()
                request_time = (end_time - start_time) * 1000
                total_time += request_time

                data = response.json()

                if "top_prediction" in data:
                    # Detailed result format
                    result = data["top_prediction"]
                    print(
                        f"      Result: {result['label']} (confidence: {result['confidence']:.4f})"
                    )
                    print(
                        f"      Processing time: {result['processing_time_ms']:.2f}ms"
                    )
                    print(f"      Request time: {request_time:.2f}ms")

                    # Show top 3 predictions for detailed results
                    if len(data["predictions"]) > 1:
                        print(f"      Top 3 predictions:")
                        for j, pred in enumerate(data["predictions"][:3], 1):
                            print(
                                f"         {j}. {pred['label']}: {pred['confidence']:.4f}"
                            )
                else:
                    # Simple result format
                    print(
                        f"      Result: {data['label']} (confidence: {data['confidence']:.4f})"
                    )
                    print(f"      Processing time: {data['processing_time_ms']:.2f}ms")
                    print(f"      Request time: {request_time:.2f}ms")

                success_count += 1

            except Exception as e:
                print(f"      ❌ Test {i} failed: {str(e)}")

        avg_time = total_time / len(test_cases) if test_cases else 0
        print(f"\n   📊 Results: {success_count}/{len(test_cases)} tests passed")
        print(f"   ⚡ Average request time: {avg_time:.2f}ms")

        return success_count == len(test_cases)


async def test_root_endpoint():
    """Test the root endpoint"""
    print("\n🏠 Testing Root Endpoint...")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/", headers=get_headers())
            response.raise_for_status()

            data = response.json()
            print(f"   Service: {data['service']}")
            print(f"   Version: {data['version']}")
            print(f"   Available models: {len(data['models'])}")
            print("   ✅ Root endpoint test passed!")
            return True

        except Exception as e:
            print(f"   ❌ Root endpoint test failed: {str(e)}")
            return False


async def main():
    """Main test function"""
    print("🤖 FastAPI Transformer Models Microservice Test")
    print("=" * 60)

    print(f"\n🔗 Testing API at: {BASE_URL}")
    print(f"🔒 Authentication: {'Required' if AUTH_REQUIRED else 'Disabled'}")
    if AUTH_REQUIRED:
        print(
            f"🔑 Using token: {AUTH_TOKEN[:8]}...{AUTH_TOKEN[-8:] if len(AUTH_TOKEN) > 16 else AUTH_TOKEN}"
        )
    print("💡 Make sure the service is running first!")

    # Test results tracking
    results = {}

    # Test health check first
    results["health"] = await test_health_check()

    if not results["health"]:
        print("\n❌ Health check failed - service may not be running!")
        print("💡 Start the service with: python main.py")
        return

    # Test root endpoint
    results["root"] = await test_root_endpoint()

    # Test all model endpoints
    for endpoint, test_cases in TEST_DATA.items():
        results[endpoint] = await test_endpoint(endpoint, test_cases)

    # Summary
    print("\n\n📊 Test Summary")
    print("=" * 40)

    total_tests = len(results)
    passed_tests = sum(1 for success in results.values() if success)

    for test_name, success in results.items():
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"   {test_name.ljust(15)}: {status}")

    print(f"\n📈 Overall: {passed_tests}/{total_tests} tests passed")

    if passed_tests == total_tests:
        print("🎉 All tests passed! The API is working correctly.")
        print("\n💡 Next steps:")
        print("   • Check the API docs at: http://localhost:8001/docs")
        print("   • Test with your own data")
        print("   • Deploy to production")
    else:
        print("⚠️  Some tests failed. Check the service logs for details.")
        print("\n🔧 Troubleshooting:")
        print("   • Ensure all dependencies are installed")
        print("   • Check if the service is running on port 8001")
        print("   • Verify internet connection for model downloads")


if __name__ == "__main__":
    asyncio.run(main())
