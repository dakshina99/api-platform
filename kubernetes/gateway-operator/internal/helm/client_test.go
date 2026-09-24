/*
Copyright 2025.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package helm

import (
	"strings"
	"testing"
)

// chartServiceName mirrors the gateway chart's fullname helper and the longest
// suffix it adds to name a Service, so these tests measure the name the API
// server actually sees rather than the release name alone. Getting this wrong is
// what let an over-long Service through: the helper inserts the chart's own name
// unless the release name already contains it.
func chartServiceName(releaseName string) string {
	fullname := releaseName
	if !strings.Contains(releaseName, helmChartName) {
		fullname = releaseName + "-" + helmChartName
	}
	return fullname + runtimeServiceSuffix
}

func TestGetReleaseName_shortNameUnchanged(t *testing.T) {
	got := GetReleaseName("platform-gw")
	want := "platform-gw-gw"
	if got != want {
		t.Fatalf("GetReleaseName() = %q, want %q", got, want)
	}
}

func TestGetReleaseName_longNameUsesStableHash(t *testing.T) {
	longName := "unresolved-gateway-with-one-attached-unresolved-route"
	got := GetReleaseName(longName)
	if !strings.HasPrefix(got, helmReleaseHashPrefix) {
		t.Fatalf("expected hashed release prefix %q, got %q", helmReleaseHashPrefix, got)
	}
	if got2 := GetReleaseName(longName); got2 != got {
		t.Fatalf("expected stable mapping, got %q and %q", got, got2)
	}
}

// TestGetReleaseName_boundaryDependsOnChartName pins the part that was wrong: a
// name carrying the chart's own name keeps the readable form for longer, because
// the chart does not have to add it back.
func TestGetReleaseName_boundaryDependsOnChartName(t *testing.T) {
	for _, tc := range []struct {
		label      string
		filler     string
		wantBudget int
	}{
		{"without the chart name", "a", 63 - len(runtimeServiceSuffix) - 1 - len(helmChartName)},
		{"with the chart name", helmChartName, 63 - len(runtimeServiceSuffix)},
	} {
		t.Run(tc.label, func(t *testing.T) {
			atLimit := (strings.Repeat(tc.filler, 64))[:tc.wantBudget-len(helmReleaseNameSuffix)]
			if got := GetReleaseName(atLimit); got != atLimit+helmReleaseNameSuffix {
				t.Fatalf("a name at the budget should keep the readable form, got %q", got)
			}
			over := (strings.Repeat(tc.filler, 64))[:tc.wantBudget-len(helmReleaseNameSuffix)+1]
			if got := GetReleaseName(over); strings.HasSuffix(got, helmReleaseNameSuffix) {
				t.Fatalf("a name past the budget should hash, got %q", got)
			}
		})
	}
}

// TestGetReleaseName_derivedServiceNamesFit is the invariant the bound exists for:
// whatever GetReleaseName returns, the Service the chart derives from it must stay
// within 63. An overflow is not rejected by Helm — the Service is rejected by the
// API server later, and the gateway runs without one.
func TestGetReleaseName_derivedServiceNamesFit(t *testing.T) {
	// Both shapes matter: a name containing the chart name takes the short path
	// through the fullname helper, a name without it takes the long one.
	for _, filler := range []string{"a", helmChartName, "my-gateway-"} {
		for n := 1; n <= 120; n++ {
			gatewayName := (strings.Repeat(filler, 128))[:n]
			service := chartServiceName(GetReleaseName(gatewayName))
			if len(service) > maxDNS1123Label {
				t.Fatalf("gateway name %q (%d chars) yields Service %q (%d chars), over the %d limit",
					gatewayName, n, service, len(service), maxDNS1123Label)
			}
		}
	}
}
