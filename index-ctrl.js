var app = angular.module("repeatApp",['vs-repeat']);



app.factory("safeApply",function(){
	return function ($scope, fn) {
            var phase = $scope.$root && $scope.$root.$$phase;
            if (phase === '$apply' || phase === '$digest') {
                if (fn) {
                    $scope.$eval(fn);
                }
            } else {
                if (fn) {
                    $scope.$apply(fn);
                } else {
                    $scope.$apply();
                }
            }
        }
	
});

app.controller("indexCtrl",function($scope){

$scope.CONSTANTS = {
	TILE : "tile",
	LIST : "list"
}
$scope.dataSet = [];

var sampleData = []
for(var i=0;i<1000;i++)
{
	sampleData[i] = i+1;
}

$scope.dataSet = sampleData;


$scope.viewConfig = {};
$scope.viewConfig.tileView = false;
$scope.changeLayout = function(value){
	$scope.viewConfig.tileView = (value === $scope.CONSTANTS.TILE) ;
}


})

